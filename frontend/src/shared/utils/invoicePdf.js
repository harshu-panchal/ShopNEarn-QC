import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

function sanitizeClonedDocument(clonedDoc) {
  const styleSheets = clonedDoc.styleSheets;
  for (let i = 0; i < styleSheets.length; i += 1) {
    try {
      const rules = styleSheets[i].cssRules || styleSheets[i].rules;
      for (let j = rules.length - 1; j >= 0; j -= 1) {
        if (rules[j].cssText && rules[j].cssText.includes("oklch")) {
          styleSheets[i].deleteRule(j);
        }
      }
    } catch {
      // Skip cross-origin stylesheets.
    }
  }

  const style = clonedDoc.createElement("style");
  style.innerHTML = `
    :root {
      --secondary: #64748b !important;
      --background: #ffffff !important;
      --foreground: #0f172a !important;
    }
  `;
  clonedDoc.head.appendChild(style);
}

/**
 * Render a DOM node to a multi-page A4 PDF and trigger download.
 */
export async function downloadInvoicePdf(element, filename = "Invoice.pdf") {
  if (!element) {
    throw new Error("Invoice element is not available");
  }

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    allowTaint: true,
    backgroundColor: "#ffffff",
    onclone: sanitizeClonedDocument,
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position -= pageHeight;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(filename);
  return filename;
}
