import type { InvoiceData, InvoiceLineItem } from "./invoice-extractor";

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

function extractNumber(text: string): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9,.-]/g, "").replace(/,/g, "");
  const num = parseFloat(cleaned);
  return isFinite(num) ? num : null;
}

function parseDate(text: string): string | null {
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  try {
    const d = new Date(text);
    if (isNaN(d.getTime())) return null;

    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return null;
  }
}

function inferCurrency(text: string): string | null {
  if (text.includes("₹")) return "INR";
  if (text.includes("$")) return "USD";
  if (text.includes("€")) return "EUR";
  if (text.includes("£")) return "GBP";

  const upper = text.toUpperCase();
  if (upper.includes("INR")) return "INR";
  if (upper.includes("USD")) return "USD";
  if (upper.includes("EUR")) return "EUR";
  if (upper.includes("GBP")) return "GBP";

  return null;
}

function parseGstDetails(lines: string[]): {
  igst_rate: number | null;
  igst_amount: number | null;
  cgst_rate: number | null;
  cgst_amount: number | null;
  sgst_rate: number | null;
  sgst_amount: number | null;
} {
  const gst = {
    igst_rate: null as number | null,
    igst_amount: null as number | null,
    cgst_rate: null as number | null,
    cgst_amount: null as number | null,
    sgst_rate: null as number | null,
    sgst_amount: null as number | null,
  };

  for (let i = 0; i < lines.length; i++) {
    const lower = normalizeText(lines[i]);

    if (lower.includes("igst")) {

      const rateMatch = lines[i].match(/(\d+(?:\.\d+)?)\s*%/);
      if (rateMatch) gst.igst_rate = parseFloat(rateMatch[1]);

      const amountMatch = lines[i].match(/igst[^0-9]*(\d+[\d.,]*)/i);
      if (amountMatch) gst.igst_amount = extractNumber(amountMatch[1]);
    }

    if (lower.includes("cgst")) {
      const rateMatch = lines[i].match(/(\d+(?:\.\d+)?)\s*%/);
      if (rateMatch) gst.cgst_rate = parseFloat(rateMatch[1]);

      const amountMatch = lines[i].match(/cgst[^0-9]*(\d+[\d.,]*)/i);
      if (amountMatch) gst.cgst_amount = extractNumber(amountMatch[1]);
    }

    if (lower.includes("sgst")) {
      const rateMatch = lines[i].match(/(\d+(?:\.\d+)?)\s*%/);
      if (rateMatch) gst.sgst_rate = parseFloat(rateMatch[1]);

      const amountMatch = lines[i].match(/sgst[^0-9]*(\d+[\d.,]*)/i);
      if (amountMatch) gst.sgst_amount = extractNumber(amountMatch[1]);
    }
  }

  return gst;
}

export function parseOcrText(rawText: string): Partial<InvoiceData> {
  const lines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  let vendor_name: string | null = null;
  let invoice_number: string | null = null;
  let invoice_date: string | null = null;
  let currency: string | null = null;
  let subtotal: number | null = null;
  let discount: number | null = null;
  let shipping: number | null = null;
  let tax: number | null = null;
  let total: number | null = null;
  const line_items: InvoiceLineItem[] = [];

  currency = inferCurrency(rawText);

  const gst = parseGstDetails(lines);

  for (const line of lines) {
    const lower = normalizeText(line);
    if (lower.match(/^(invoice\s*(no|#)|inv-?|invoice)/i)) {
      const parts = line.split(/[:=]/);
      if (parts.length > 1) {
        const candidate = parts[1].trim();
        if (candidate.length > 0 && candidate.length < 50) {
          invoice_number = candidate;
          break;
        }
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const lower = normalizeText(lines[i]);
    if (lower.match(/(date|dated|invoice\s*date)/i)) {
      const parts = lines[i].split(/[:=]/);
      if (parts.length > 1) {
        const candidate = parseDate(parts[1].trim());
        if (candidate) {
          invoice_date = candidate;
          break;
        }
      }

      if (i + 1 < lines.length) {
        const candidate = parseDate(lines[i + 1]);
        if (candidate) {
          invoice_date = candidate;
          break;
        }
      }
    }
  }

  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i].trim();
    const lower = normalizeText(line);

    if (line.length > 3 && line.length < 80 && 
        !lower.match(/(invoice|date|address|email|phone|tel|plot|road|suite|st\.?|city)/i) &&
        !line.match(/^\d+/) &&
        vendor_name === null) {
      vendor_name = line;
      break;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const lower = normalizeText(lines[i]);

    if (lower.match(/^subtotal\s*[:\s]/)) {
      const num = extractNumber(lines[i].split(/[:\s]+/).pop() || "");
      if (num !== null) subtotal = num;
    }

    if (lower.match(/(discount|less)\s*[:\s]/) && !lower.match(/discount\s*%/)) {
      const num = extractNumber(lines[i].split(/[:\s]+/).pop() || "");
      if (num !== null && num > 0) discount = num;
    }

    if (lower.match(/(shipping|delivery|handling|freight)\s*[:\s]/)) {
      const num = extractNumber(lines[i].split(/[:\s]+/).pop() || "");
      if (num !== null && num > 0) shipping = num;
    }

    if (lower.match(/(tax|igst|gst|vat)\s*[:\s]/) && !lower.match(/tax%|igst\s*%|gst\s*%/)) {
      const num = extractNumber(lines[i].split(/[:\s]+/).pop() || "");
      if (num !== null && num > 0) {
        if (tax === null) tax = num;
      }
    }

    if (lower.match(/^(total|grand\s*total|amount\s*(due|payable))\s*[:\s]?/)) {
      const parts = lines[i].split(/[:\s]+/);
      const candidate = parts[parts.length - 1];
      const num = extractNumber(candidate);
      if (num !== null && num > 0) {
        if (total === null) total = num;
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = normalizeText(line);

    if (lower.match(/(description|qty|quantity|price|rate|total|hsn|sac|gst|tax|invoice|date|address)/i)) {
      continue;
    }

    const numbers = line.match(/\d+[\d.,]*/g) || [];
    if (numbers.length >= 2) {
      const parts = line.split(/\s+/);
      const description = parts.slice(0, -numbers.length).join(" ");

      if (description.trim().length > 0 && description.trim().length < 100) {
        const lastNum = extractNumber(numbers[numbers.length - 1]);
        const secondLastNum = numbers.length > 1 ? extractNumber(numbers[numbers.length - 2]) : null;
        const thirdLastNum = numbers.length > 2 ? extractNumber(numbers[numbers.length - 3]) : null;

        if (lastNum !== null && lastNum > 0) {
          const item: InvoiceLineItem = {
            description: description.trim() || null,
            quantity: thirdLastNum && thirdLastNum < 1000 ? thirdLastNum : null,
            unit_price: secondLastNum && secondLastNum > 0 && secondLastNum !== lastNum ? secondLastNum : null,
            discount: null,
            tax: null,
            line_total: lastNum,
            hsn_code: null,
            unit: null,
            discount_percentage: null,
            tax_rate: null
          };

          if (item.description && item.line_total) {
            line_items.push(item);
          }
        }
      }
    }
  }

  if (total === null && subtotal !== null) {
    total = subtotal - (discount ?? 0) + (shipping ?? 0) + (tax ?? 0);
  }

  return {
    vendor_name,
    invoice_number,
    invoice_date,
    currency,
    subtotal,
    discount,
    shipping,
    tax,
    total,
    igst_rate: gst.igst_rate,
    igst_amount: gst.igst_amount,
    cgst_rate: gst.cgst_rate,
    cgst_amount: gst.cgst_amount,
    sgst_rate: gst.sgst_rate,
    sgst_amount: gst.sgst_amount,
    line_items,
  };
}

