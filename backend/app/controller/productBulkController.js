import ExcelJS from "exceljs";
import crypto from "crypto";
import Product from "../models/product.js";
import Category from "../models/category.js";
import { handleResponse } from "../utils/helper.js";
import { uploadToCloudinary } from "../services/mediaService.js";
import axios from "axios";
import logger from "../services/logger.js";
import { enqueueProductIndex } from "../services/searchSyncService.js";
import { buildKey, invalidate } from "../services/cacheService.js";
import { getProductApprovalConfig } from "../services/productModerationService.js";
import { slugify } from "../utils/slugify.js";

// Helper to sanitize category names for Excel Defined Names.
// IMPORTANT: This must produce EXACTLY the same string as the SUBSTITUTE()
// chain used in the cascading dropdown formulae below. Do not collapse
// consecutive underscores here — Excel's SUBSTITUTE does not, so collapsing
// would make INDIRECT() reference a non-existent name (e.g. "Fruits & Vegetables"
// -> defined "SC_Fruits_Vegetables" but formula expects "SC_Fruits___Vegetables"),
// leaving the sub-category dropdown empty.
function getExcelRangeName(prefix, name) {
  const cleanName = name.replace(/[ &\-\/\(\),]/g, "_"); // replace spaces & special characters with underscores
  return `${prefix}_${cleanName}`;
}

// Convert column index to Excel column letter (e.g. 1 -> A, 27 -> AA)
function getColumnLetter(colIdx) {
  let temp = colIdx;
  let letter = "";
  while (temp > 0) {
    let modulo = (temp - 1) % 26;
    letter = String.fromCharCode(65 + modulo) + letter;
    temp = Math.floor((temp - modulo) / 26);
  }
  return letter;
}

// Helper to generate SKU (mirroring productController.js makeProductSku)
function makeProductSku(name, index = 1) {
  const prefix = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 5) || "item";
  const randomSuffix = crypto.randomBytes(2).toString("hex");
  return `${prefix}-${String(index).padStart(3, "0")}-${randomSuffix}`;
}

// ExcelJS stores hyperlinks / rich text as objects — String() yields "[object Object]".
function normalizeHyperlink(hyperlink) {
  if (!hyperlink) return "";
  if (typeof hyperlink === "string") return hyperlink.trim();
  if (typeof hyperlink === "object" && hyperlink.target) {
    return String(hyperlink.target).trim();
  }
  return "";
}

export function parseCommaSeparatedUrls(str) {
  if (!str) return [];
  const trimmed = String(str).trim();
  if (!trimmed || trimmed === "[object Object]") return [];

  // Pull every http(s) URL from the cell regardless of delimiter (comma, semicolon, newline, space).
  const fromRegex = trimmed.match(/https?:\/\/[^\s,;|"']+/gi);
  if (fromRegex && fromRegex.length > 0) {
    const cleaned = fromRegex.map((u) =>
      u.trim().replace(/[)\].]+$/, ""),
    );
    return [...new Set(cleaned.filter((u) => /^https?:\/\//i.test(u)))];
  }

  return trimmed
    .split(/[,;\r\n]+/)
    .map((u) => u.trim())
    .filter((u) => u && /^https?:\/\//i.test(u));
}

export function getCellStringValue(cell, options = {}) {
  const { preferTextForUrls = false } = options;
  if (!cell) return "";
  const value = cell.value;
  if (value === null || value === undefined) {
    return normalizeHyperlink(cell.hyperlink);
  }

  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  if (typeof value === "object") {
    const link = typeof value.hyperlink === "string" ? value.hyperlink.trim() : "";
    const text =
      value.text !== undefined && value.text !== null
        ? String(value.text).trim()
        : "";

    if (preferTextForUrls && text && /https?:\/\//i.test(text)) {
      const textUrlCount = parseCommaSeparatedUrls(text).length;
      const linkUrlCount = link ? parseCommaSeparatedUrls(link).length : 0;
      if (
        textUrlCount > linkUrlCount ||
        text.includes(",") ||
        text.includes(";") ||
        /\r?\n/.test(text)
      ) {
        return text;
      }
    }

    if (link) return link;
    if (text && text !== "[object Object]") return text;
    if (Array.isArray(value.richText)) {
      const joined = value.richText.map((part) => part?.text ?? "").join("").trim();
      if (joined) return joined;
    }
    if (value.result !== undefined && value.result !== null) {
      return getCellStringValue({ ...cell, value: value.result }, options);
    }
  }

  const cellLink = normalizeHyperlink(cell.hyperlink);
  if (cellLink) return cellLink;

  const fallback = String(value).trim();
  return fallback === "[object Object]" ? "" : fallback;
}

// Helper to download an external image URL and upload it to Cloudinary
async function downloadAndUploadToCloudinary(url) {
  const normalized = String(url || "").trim();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    throw new Error("Invalid URL protocol. Must start with http:// or https://");
  }

  const response = await axios.get(normalized, {
    responseType: "arraybuffer",
    timeout: 10000, // 10s timeout
  });

  const contentType = response.headers["content-type"] || "image/jpeg";
  const buffer = Buffer.from(response.data);

  const cloudinaryUrl = await uploadToCloudinary(buffer, "products", {
    mimeType: contentType,
    resourceType: "image",
  });

  return cloudinaryUrl;
}

/* ============================================================
   GET BULK UPLOAD TEMPLATE
============================================================ */
export const getBulkUploadTemplate = async (req, res) => {
  try {
    // 1. Fetch active categories in a tree structure
    const mainGroups = await Category.find({ type: "header", status: "active" })
      .populate({
        path: "children",
        match: { status: "active" },
        populate: {
          path: "children",
          match: { status: "active" },
        },
      })
      .sort({ name: 1 })
      .lean();

    // 2. Initialize workbook
    const workbook = new ExcelJS.Workbook();
    const productsSheet = workbook.addWorksheet("Products");
    const categoriesSheet = workbook.addWorksheet("_CategoriesData");

    // Hide the categories sheet to prevent user confusion
    categoriesSheet.state = "hidden";

    // 3. Write data to _CategoriesData and register Defined Names
    let colIdx = 1; // Column A

    // Write Main Groups in Column A
    for (let i = 0; i < mainGroups.length; i++) {
      categoriesSheet.getCell(i + 2, 1).value = mainGroups[i].name;
    }
    if (mainGroups.length > 0) {
      workbook.definedNames.add(
        `_CategoriesData!$A$2:$A$${mainGroups.length + 1}`,
        "MainGroupsList"
      );
    }

    // Write specific categories and sub-categories in subsequent columns
    for (const mg of mainGroups) {
      colIdx++;
      const mgColLetter = getColumnLetter(colIdx);
      const categories = mg.children || [];

      if (categories.length > 0) {
        for (let i = 0; i < categories.length; i++) {
          categoriesSheet.getCell(i + 2, colIdx).value = categories[i].name;
        }
        const rangeName = getExcelRangeName("MG", mg.name);
        workbook.definedNames.add(
          `_CategoriesData!$${mgColLetter}$2:$${mgColLetter}$${categories.length + 1}`,
          rangeName
        );
      } else {
        categoriesSheet.getCell(2, colIdx).value = "";
        const rangeName = getExcelRangeName("MG", mg.name);
        workbook.definedNames.add(
          `_CategoriesData!$${mgColLetter}$2:$${mgColLetter}$2`,
          rangeName
        );
      }

      for (const cat of categories) {
        colIdx++;
        const catColLetter = getColumnLetter(colIdx);
        const subcategories = cat.children || [];

        if (subcategories.length > 0) {
          for (let i = 0; i < subcategories.length; i++) {
            categoriesSheet.getCell(i + 2, colIdx).value = subcategories[i].name;
          }
          const rangeName = getExcelRangeName("SC", cat.name);
          workbook.definedNames.add(
            `_CategoriesData!$${catColLetter}$2:$${catColLetter}$${subcategories.length + 1}`,
            rangeName
          );
        } else {
          categoriesSheet.getCell(2, colIdx).value = "";
          const rangeName = getExcelRangeName("SC", cat.name);
          workbook.definedNames.add(
            `_CategoriesData!$${catColLetter}$2:$${catColLetter}$2`,
            rangeName
          );
        }
      }
    }

    // 4. Style Products Sheet
    // Title Banner
    const titleCell = productsSheet.getCell("A1");
    titleCell.value = "SHOP & EARN - SELLER BULK PRODUCT UPLOAD TEMPLATE";
    titleCell.font = { name: "Segoe UI", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    titleCell.alignment = { vertical: "middle", horizontal: "center" };
    productsSheet.getRow(1).height = 35;
    productsSheet.mergeCells("A1:AK1");

    // Instructions Block
    const instructions = [
      "INSTRUCTIONS & RULES:",
      "1. Columns marked with * are required. Do NOT rename, delete, or rearrange any column headers.",
      "2. Select Main Group, Specific Category, and Sub-Category from the dropdown lists. Typing invalid category names will cause errors.",
      "3. Variant 1 is the primary product configuration and is REQUIRED. You can add up to 4 more optional variants (Variants 2-5).",
      "4. Images: Enter direct URLs (HTTP/HTTPS) or leave empty. Empty images can be uploaded manually in the Seller Panel after importing.",
      "5. Row 7 is a sample row. You can delete or overwrite it before uploading."
    ];

    for (let i = 0; i < instructions.length; i++) {
      const rowNum = i + 2;
      const cell = productsSheet.getCell(`A${rowNum}`);
      cell.value = instructions[i];
      cell.font = { name: "Segoe UI", size: 9, italic: i > 0, bold: i === 0, color: { argb: i === 0 ? "FF111827" : "FF4B5563" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
      productsSheet.mergeCells(`A${rowNum}:AK${rowNum}`);
      productsSheet.getRow(rowNum).height = 18;
    }

    // Headers
    const headers = [
      "Product Title *", "Description", "Brand Name", "Product Code (SKU)", "Weight", "Tags (comma-separated)",
      "Main Group *", "Specific Category *", "Sub-Category *", "Status (Active/Draft)", "Main Image URL", "Gallery Image URLs (comma-separated)",
      "Variant 1 Name *", "Variant 1 Price *", "Variant 1 Sale Price", "Variant 1 Stock *", "Variant 1 SKU",
      "Variant 2 Name", "Variant 2 Price", "Variant 2 Sale Price", "Variant 2 Stock", "Variant 2 SKU",
      "Variant 3 Name", "Variant 3 Price", "Variant 3 Sale Price", "Variant 3 Stock", "Variant 3 SKU",
      "Variant 4 Name", "Variant 4 Price", "Variant 4 Sale Price", "Variant 4 Stock", "Variant 4 SKU",
      "Variant 5 Name", "Variant 5 Price", "Variant 5 Sale Price", "Variant 5 Stock", "Variant 5 SKU"
    ];

    const headerRow = productsSheet.getRow(6);
    headerRow.values = headers;
    headerRow.height = 25;

    const headerStyles = [
      { start: 1, end: 6, bg: "FFDBEAFE", fg: "FF1E3A8A" }, // Product Info - Pastel Blue
      { start: 7, end: 10, bg: "FFD1FAE5", fg: "FF064E3B" }, // Category & Status - Pastel Green
      { start: 11, end: 12, bg: "FFE0E7FF", fg: "FF312E81" }, // Images - Pastel Indigo
      { start: 13, end: 17, bg: "FFFFEDD5", fg: "FF7C2D12" }, // Variant 1 - Pastel Orange
      { start: 18, end: 37, bg: "FFF3F4F6", fg: "FF374151" }  // Variants 2-5 - Pastel Gray
    ];

    headerStyles.forEach((style) => {
      for (let c = style.start; c <= style.end; c++) {
        const cell = headerRow.getCell(c);
        cell.font = { name: "Segoe UI", size: 9, bold: true, color: { argb: style.fg } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: style.bg } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: 'FFD1D5DB' } },
          bottom: { style: "medium", color: { argb: 'FF9CA3AF' } },
          left: { style: "thin", color: { argb: 'FFD1D5DB' } },
          right: { style: "thin", color: { argb: 'FFD1D5DB' } }
        };
      }
    });

    // Determine sample categories based on active database entries
    let sampleMainGroup = "Grocery";
    let sampleCategory = "Atta, Rice & Dal";
    let sampleSubCategory = "Basmati Rice";
    if (mainGroups.length > 0) {
      sampleMainGroup = mainGroups[0].name;
      const firstChild = mainGroups[0].children?.[0];
      if (firstChild) {
        sampleCategory = firstChild.name;
        const firstSub = firstChild.children?.[0];
        if (firstSub) {
          sampleSubCategory = firstSub.name;
        }
      }
    }

    // Sample Row
    const sampleRow = [
      "Sample Premium Basmati Rice",
      "Aromatic premium basmati rice, aged to perfection.",
      "Deccan",
      "DECCAN-RICE-001",
      "1kg",
      "rice, grain, organic",
      sampleMainGroup,
      sampleCategory,
      sampleSubCategory,
      "Active",
      "https://images.unsplash.com/photo-1586201375761-83865001e31c?q=80&w=600",
      "https://images.unsplash.com/photo-1586201375761-83865001e31c?q=80&w=600, https://images.unsplash.com/photo-1536304993881-ff6ae9dfb3b0?q=80&w=600, https://images.unsplash.com/photo-1516684669134-549d3ec99894?q=80&w=600",
      "1kg Pack",
      250,
      220,
      100,
      "DECCAN-RICE-1KG",
      "5kg Pack",
      1100,
      999,
      50,
      "DECCAN-RICE-5KG"
    ];

    const sampleRowObj = productsSheet.getRow(7);
    sampleRowObj.values = sampleRow;
    sampleRowObj.height = 20;
    for (let c = 1; c <= headers.length; c++) {
      const cell = sampleRowObj.getCell(c);
      cell.font = { name: "Segoe UI", size: 9, color: { argb: "FF6B7280" } };
      cell.alignment = { vertical: "middle" };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } }
      };
    }

    // Set Column Widths
    productsSheet.columns.forEach((col, idx) => {
      if (idx === 0) col.width = 28; // Title
      else if (idx === 1) col.width = 35; // Description
      else if (idx === 6 || idx === 7 || idx === 8) col.width = 22; // Categories
      else if (idx === 10 || idx === 11) col.width = 25; // Image URLs
      else col.width = 15; // standard
    });

    // 5. Apply Data Validation Dropdowns for rows 8 to 300
    for (let r = 8; r <= 300; r++) {
      // Main Group dropdown
      if (mainGroups.length > 0) {
        productsSheet.getCell(`G${r}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: ["MainGroupsList"],
        };
      }

      // Cascading Specific Category dropdown using INDIRECT + SUBSTITUTE
      productsSheet.getCell(`H${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [
          `INDIRECT(CONCATENATE("MG_", SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(G${r}," ","_"),"&","_"),"-","_"),"/","_"),"(","_"),")","_"),",","_")))`,
        ],
      };

      // Cascading Sub-Category dropdown
      productsSheet.getCell(`I${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [
          `INDIRECT(CONCATENATE("SC_", SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(H${r}," ","_"),"&","_"),"-","_"),"/","_"),"(","_"),")","_"),",","_")))`,
        ],
      };

      // Status dropdown
      productsSheet.getCell(`J${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"Active,Draft"'],
      };
    }

    // 6. Response Headers and Download Stream
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=products_bulk_upload_template.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error("Failed to generate bulk upload template", { error });
    return handleResponse(res, 500, "Failed to generate Excel template: " + error.message);
  }
};

/* ============================================================
   BULK UPLOAD PRODUCTS
============================================================ */
export const bulkUploadProducts = async (req, res) => {
  try {
    if (!req.file) {
      return handleResponse(res, 400, "Excel template file is required");
    }

    // 1. Fetch active category tree to resolve text names in-memory
    const activeHeaders = await Category.find({ type: "header", status: "active" })
      .populate({
        path: "children",
        match: { status: "active" },
        populate: {
          path: "children",
          match: { status: "active" },
        },
      })
      .lean();

    const categoryMap = {};
    for (const h of activeHeaders) {
      const hName = h.name.trim().toLowerCase();
      categoryMap[hName] = {
        id: h._id,
        children: {},
      };
      const children = h.children || [];
      for (const c of children) {
        const cName = c.name.trim().toLowerCase();
        categoryMap[hName].children[cName] = {
          id: c._id,
          children: {},
        };
        const subchildren = c.children || [];
        for (const sc of subchildren) {
          const scName = sc.name.trim().toLowerCase();
          categoryMap[hName].children[cName].children[scName] = sc._id;
        }
      }
    }

    // 2. Load and parse the Workbook
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      return handleResponse(res, 400, "Spreadsheet contains no worksheets");
    }

    const errors = [];
    const warnings = [];
    let successCount = 0;
    let failureCount = 0;

    const rowCount = worksheet.rowCount;
    const isSampleRow = (row) => {
      const title = row.getCell(1).value;
      const sku = row.getCell(4).value;
      return (
        String(title || "").trim() === "Sample Premium Basmati Rice" ||
        String(sku || "").trim() === "DECCAN-RICE-001"
      );
    };

    // Iterate starting from row 7 (headers end at row 6)
    for (let r = 7; r <= rowCount; r++) {
      const row = worksheet.getRow(r);
      const titleVal = row.getCell(1).value;

      if (!titleVal) continue; // Skip empty rows
      if (isSampleRow(row)) continue; // Skip sample row

      try {
        const name = String(titleVal).trim();
        const description = row.getCell(2).value ? String(row.getCell(2).value).trim() : "";
        const brand = row.getCell(3).value ? String(row.getCell(3).value).trim() : "";
        const sku = row.getCell(4).value ? String(row.getCell(4).value).trim() : "";
        const weight = row.getCell(5).value ? String(row.getCell(5).value).trim() : "";
        const rawTags = row.getCell(6).value ? String(row.getCell(6).value).trim() : "";
        const mainGroup = row.getCell(7).value ? String(row.getCell(7).value).trim() : "";
        const categoryName = row.getCell(8).value ? String(row.getCell(8).value).trim() : "";
        const subcategoryName = row.getCell(9).value ? String(row.getCell(9).value).trim() : "";
        const statusVal = row.getCell(10).value ? String(row.getCell(10).value).trim().toLowerCase() : "active";
        const mainImageUrl = getCellStringValue(row.getCell(11));
        const galleryUrlsStr = getCellStringValue(row.getCell(12), {
          preferTextForUrls: true,
        });

        // Row valid check
        if (!name) throw new Error("Product Title is required");
        if (!mainGroup) throw new Error("Main Group category is required");
        if (!categoryName) throw new Error("Specific Category is required");
        if (!subcategoryName) throw new Error("Sub-Category is required");

        // Resolve Category IDs
        const mgKey = mainGroup.toLowerCase();
        const catKey = categoryName.toLowerCase();
        const subcatKey = subcategoryName.toLowerCase();

        if (!categoryMap[mgKey]) {
          throw new Error(`Main Group '${mainGroup}' not found or inactive`);
        }
        if (!categoryMap[mgKey].children[catKey]) {
          throw new Error(`Specific Category '${categoryName}' not found or inactive under Main Group '${mainGroup}'`);
        }
        if (!categoryMap[mgKey].children[catKey].children[subcatKey]) {
          throw new Error(`Sub-Category '${subcategoryName}' not found or inactive under Specific Category '${categoryName}'`);
        }

        const headerId = categoryMap[mgKey].id;
        const categoryId = categoryMap[mgKey].children[catKey].id;
        const subcategoryId = categoryMap[mgKey].children[catKey].children[subcatKey];

        const status = statusVal === "draft" || statusVal === "inactive" ? "inactive" : "active";
        const tags = rawTags ? rawTags.split(",").map((t) => t.trim()).filter(Boolean) : [];

        // Parse Variants (Variant 1 is required)
        const variants = [];
        const v1Name = row.getCell(13).value ? String(row.getCell(13).value).trim() : "";
        const v1PriceVal = row.getCell(14).value;
        const v1SalePriceVal = row.getCell(15).value;
        const v1StockVal = row.getCell(16).value;
        const v1Sku = row.getCell(17).value ? String(row.getCell(17).value).trim() : "";

        if (!v1Name) throw new Error("Variant 1 Name is required");
        if (v1PriceVal === null || v1PriceVal === undefined || isNaN(Number(v1PriceVal)) || Number(v1PriceVal) < 0) {
          throw new Error("Variant 1 Price must be a valid positive number");
        }
        if (v1StockVal === null || v1StockVal === undefined || isNaN(Number(v1StockVal)) || Number(v1StockVal) < 0) {
          throw new Error("Variant 1 Stock must be a valid non-negative integer");
        }

        const v1Price = Number(v1PriceVal);
        const v1SalePrice = v1SalePriceVal ? Number(v1SalePriceVal) : 0;
        const v1Stock = Number(v1StockVal);

        variants.push({
          name: v1Name,
          price: v1Price,
          salePrice: v1SalePrice,
          stock: v1Stock,
          sku: v1Sku || makeProductSku(name, 1),
        });

        // Additional variants (2-5)
        for (let v = 2; v <= 5; v++) {
          const startCol = 13 + (v - 1) * 5; // Variant 2 starts at 18
          const vName = row.getCell(startCol).value ? String(row.getCell(startCol).value).trim() : "";
          const vPriceVal = row.getCell(startCol + 1).value;
          const vSalePriceVal = row.getCell(startCol + 2).value;
          const vStockVal = row.getCell(startCol + 3).value;
          const vSku = row.getCell(startCol + 4).value ? String(row.getCell(startCol + 4).value).trim() : "";

          if (vName || vPriceVal !== null || vStockVal !== null) {
            if (!vName) throw new Error(`Variant ${v} Name is required when variant columns are populated`);
            if (vPriceVal === null || vPriceVal === undefined || isNaN(Number(vPriceVal)) || Number(vPriceVal) < 0) {
              throw new Error(`Variant ${v} Price must be a valid positive number`);
            }
            if (vStockVal === null || vStockVal === undefined || isNaN(Number(vStockVal)) || Number(vStockVal) < 0) {
              throw new Error(`Variant ${v} Stock must be a valid non-negative integer`);
            }

            variants.push({
              name: vName,
              price: Number(vPriceVal),
              salePrice: vSalePriceVal ? Number(vSalePriceVal) : 0,
              stock: Number(vStockVal),
              sku: vSku || makeProductSku(name, v),
            });
          }
        }

        // Image Downloading & Uploading
        let mainImage = "";
        const galleryImages = [];

        if (mainImageUrl) {
          try {
            mainImage = await downloadAndUploadToCloudinary(mainImageUrl);
          } catch (imgErr) {
            warnings.push(`Row ${r}: Failed to download Main Image from '${mainImageUrl}': ${imgErr.message}`);
          }
        }

        if (galleryUrlsStr) {
          const urls = parseCommaSeparatedUrls(galleryUrlsStr);
          for (const url of urls) {
            try {
              const uploadedUrl = await downloadAndUploadToCloudinary(url);
              galleryImages.push(uploadedUrl);
            } catch (imgErr) {
              warnings.push(`Row ${r}: Failed to download Gallery Image from '${url}': ${imgErr.message}`);
            }
          }
        }

        // Build product payload
        const productData = {
          name,
          description,
          brand,
          sku: sku || makeProductSku(name, 1),
          weight,
          tags,
          headerId,
          categoryId,
          subcategoryId,
          status,
          price: v1Price,
          salePrice: v1SalePrice,
          stock: v1Stock,
          variants,
          mainImage,
          galleryImages,
          sellerId: req.user.id,
        };

        // Create unique slug
        const randomSuffix = crypto.randomBytes(3).toString("hex");
        productData.slug = slugify(name) + "-" + randomSuffix;

        // Determine approval configuration
        const role = String(req.user?.role || "").toLowerCase();
        let moderationUpdate = {};
        if (role === "admin") {
          moderationUpdate = {
            approvalStatus: "approved",
            approvalRequestedAt: null,
            approvalReviewedAt: new Date(),
            lastSubmittedByRole: "admin",
          };
        } else {
          const approvalConfig = await getProductApprovalConfig();
          if (approvalConfig.sellerCreateRequiresApproval) {
            moderationUpdate = {
              approvalStatus: "pending",
              approvalRequestedAt: new Date(),
              lastSubmittedByRole: "seller",
            };
          } else {
            moderationUpdate = {
              approvalStatus: "approved",
              approvalRequestedAt: null,
              lastSubmittedByRole: "seller",
            };
          }
        }
        Object.assign(productData, moderationUpdate);

        // Save
        const product = await Product.create(productData);
        if (product && product._id) {
          await enqueueProductIndex(product._id.toString());
          await invalidate(`cache:catalog:product:${product._id.toString()}`);
        }

        successCount++;
      } catch (rowErr) {
        failureCount++;
        errors.push({
          row: r,
          productName: titleVal || `Row ${r}`,
          message: rowErr.message,
        });
      }
    }

    // Invalidate list cache
    if (successCount > 0) {
      try {
        await invalidate(buildKey("catalog", "productList", "*"));
        await invalidate("cache:offersections:public:*");
      } catch (cacheErr) {
        logger.error("Cache invalidation error in bulk upload", { cacheErr });
      }
    }

    return handleResponse(res, 200, "Spreadsheet processed successfully", {
      successCount,
      failureCount,
      errors,
      warnings,
    });
  } catch (error) {
    logger.error("Create Product Error in Bulk Upload", { error });
    if (error.code === 11000) {
      return handleResponse(res, 400, "One of the product codes (SKU) or Slugs already exists in the system.");
    }
    return handleResponse(res, 500, error.message);
  }
};
