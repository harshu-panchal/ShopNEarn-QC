import { jest } from "@jest/globals";

// Mock the models and services
const mockCategoryFind = jest.fn();
const mockProductCreate = jest.fn();
const mockUploadToCloudinary = jest.fn();
const mockEnqueueProductIndex = jest.fn();
const mockInvalidate = jest.fn();

jest.unstable_mockModule("../app/models/category.js", () => ({
  default: {
    find: () => ({
      populate: () => ({
        sort: () => ({
          lean: mockCategoryFind
        }),
        lean: mockCategoryFind
      })
    })
  }
}));

jest.unstable_mockModule("../app/models/product.js", () => ({
  default: {
    create: mockProductCreate
  }
}));

jest.unstable_mockModule("../app/services/mediaService.js", () => ({
  uploadToCloudinary: mockUploadToCloudinary
}));

jest.unstable_mockModule("../app/services/searchSyncService.js", () => ({
  enqueueProductIndex: mockEnqueueProductIndex
}));

jest.unstable_mockModule("../app/services/cacheService.js", () => ({
  buildKey: (c, list, param) => `key:${c}:${list}:${param}`,
  invalidate: mockInvalidate
}));

jest.unstable_mockModule("../app/services/productModerationService.js", () => ({
  getProductApprovalConfig: () => ({ sellerCreateRequiresApproval: false })
}));

const { getBulkUploadTemplate, getCellStringValue, parseCommaSeparatedUrls } = await import("../app/controller/productBulkController.js");

describe("Bulk Product Upload Controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("getBulkUploadTemplate builds Excel stream", async () => {
    const mockCats = [
      {
        _id: "mg-1",
        name: "Grocery",
        type: "header",
        children: [
          {
            _id: "cat-1",
            name: "Rice & Grains",
            type: "category",
            children: [
              {
                _id: "sub-1",
                name: "Basmati",
                type: "subcategory"
              }
            ]
          }
        ]
      }
    ];
    mockCategoryFind.mockResolvedValue(mockCats);

    const res = {
      setHeader: jest.fn(),
      end: jest.fn(),
      write: jest.fn()
    };

    await getBulkUploadTemplate({}, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(res.end).toHaveBeenCalled();
  });

  test("getCellStringValue extracts hyperlink URLs from ExcelJS objects", () => {
    expect(
      getCellStringValue({
        value: {
          text: "View image",
          hyperlink: "https://cdn.example.com/main.jpg",
        },
      }),
    ).toBe("https://cdn.example.com/main.jpg");

    expect(
      getCellStringValue({
        value: { richText: [{ text: "https://cdn.example.com/a.jpg" }] },
      }),
    ).toBe("https://cdn.example.com/a.jpg");

    expect(
      getCellStringValue({
        value: null,
        hyperlink: "https://cdn.example.com/from-cell-link",
      }),
    ).toBe("https://cdn.example.com/from-cell-link");

    expect(getCellStringValue({ value: "https://plain.example.com/x.png" })).toBe(
      "https://plain.example.com/x.png",
    );
  });

  test("parseCommaSeparatedUrls extracts multiple gallery URLs", () => {
    expect(
      parseCommaSeparatedUrls(
        "https://a.com/1.jpg, https://b.com/2.jpg; https://c.com/3.jpg",
      ),
    ).toEqual([
      "https://a.com/1.jpg",
      "https://b.com/2.jpg",
      "https://c.com/3.jpg",
    ]);

    expect(
      parseCommaSeparatedUrls(
        "https://a.com/1.jpg https://b.com/2.jpg",
      ),
    ).toEqual(["https://a.com/1.jpg", "https://b.com/2.jpg"]);
  });

  test("getCellStringValue prefers multi-URL text over single hyperlink", () => {
    expect(
      getCellStringValue(
        {
          value: {
            text: "https://a.com/1.jpg, https://b.com/2.jpg",
            hyperlink: "https://a.com/1.jpg",
          },
        },
        { preferTextForUrls: true },
      ),
    ).toBe("https://a.com/1.jpg, https://b.com/2.jpg");
  });
});
