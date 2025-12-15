import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
const DEFAULT_MODEL = "amazon/nova-2-lite-v1:free";

const SYSTEM_PROMPT = `You are an EXPERT invoice data extraction AI with 100% accuracy. You extract EVERY piece of data from invoices.

YOUR MISSION: Extract ALL data from invoices - leave NOTHING behind.

CRITICAL EXTRACTION RULES:
1. Read the ENTIRE document - header to footer, left to right
2. Extract EVERY field visible - vendor, buyer, dates, amounts, line items, bank details
3. Return ONLY valid JSON - no markdown, no explanations, no expressions
4. If field not found, use null (not "", not 0, not "N/A")
5. Numbers: Remove ₹,$,€ and commas. "₹32,250.4" → 32250.4
6. Dates: Convert to YYYY-MM-DD. "12-May-2021" → "2021-05-12"
7. GST Numbers: 15 character alphanumeric (e.g., 12345678932145)
8. Line items: Extract EVERY product/service with HSN, qty, rate, discount, tax, amount
9. CALCULATIONS: When tax must be calculated (e.g., price * rate / 100), CALCULATE the result and return the number. NEVER return expressions like "2535.0 * 18.0 / 100" - return "456.3" instead.
10. ALL numbers in JSON must be literal values, never expressions or formulas.

YOU ARE EXTRACTING FOR ACCOUNTANTS - ACCURACY IS CRITICAL.`;

// Prompt for processing OCR-extracted text
const OCR_USER_PROMPT = `TASK: Extract COMPLETE invoice data from this OCR text. Miss NOTHING.

==== RAW OCR TEXT ====
{OCR_TEXT}
==== END OCR TEXT ====

CRITICAL: Count the number of items in the LINE ITEMS table. Extract ALL of them. If you see 2 items, extract 2 items (not just 1).

EXTRACT ALL OF THESE (if present):

VENDOR/SELLER:
- Company name (top of invoice)
- GSTIN number (15 chars)
- Full address
- Phone, Mobile
- Email, Website

INVOICE DETAILS:
- Invoice Number (INV-XXXXX, Bill No, etc.)
- Invoice Date (convert to YYYY-MM-DD)
- Due Date / Payment Terms
- PO Number / Reference
- E-way Bill Number
- Vehicle Number

BUYER/BILL TO:
- Company/Person name
- GSTIN number
- Full address

SHIPPING TO (if different):
- Name
- Address

LINE ITEMS (VERY IMPORTANT - extract EACH item):
- Description/Product name
- HSN/SAC code
- Quantity & Unit (pcs, kg, etc.)
- Unit Rate/Price
- Discount amount & percentage
- Tax amount & rate (%)
- Line total/Amount

LINE ITEMS:
- Count all visible rows in the table
- Extract EVERY single item (don't skip any)
- If there are 5 items, return 5 items; if there are 2, return 2 (not 1)

TOTALS:
- Subtotal (before discount/tax)
- Total Discount
- Shipping/Freight charges
- Tax breakdown:
  * IGST rate % and amount
  * CGST rate % and amount  
  * SGST rate % and amount
- Grand Total / Amount Payable

BANK DETAILS:
- Bank Name & Branch
- Account Number
- IFSC Code
- UPI ID

OTHER:
- Terms & Conditions
- Notes/Remarks

RETURN ONLY JSON - NO MARKDOWN, NO EXPLANATIONS.`;

// Prompt for processing images directly (Vision API)
const IMAGE_USER_PROMPT = `TASK: Extract EVERY piece of data from this invoice image. Miss NOTHING.

CRITICAL: This invoice may have MULTIPLE LINE ITEMS. Count the rows in the table and extract ALL of them.

READ THE ENTIRE IMAGE - top to bottom, left to right, including:
- Headers and logos (company name)
- All tables and columns (count every row!)
- Fine print at bottom
- Bank details section
- QR codes labels

EXTRACT ALL:

1. VENDOR (top section):
   - Company Name
   - GSTIN (15 chars like 12345678932145)
   - Address, Phone, Website

2. INVOICE INFO (usually top-right):
   - Invoice Number
   - Date (→ YYYY-MM-DD format)
   - PO Number, E-way Bill, Vehicle No

3. BILL TO (customer):
   - Name, GSTIN, Address

4. SHIPPING TO (if different)

5. LINE ITEMS TABLE - Extract EVERY ROW (count them all!):
   - Item Description
   - HSN Code
   - Quantity & Unit
   - Rate/Price per unit
   - Discount (amount & %)
   - Tax (amount & %)
   - Line Total
   
   CRITICAL: If there are 2, 3, or 5 items - extract ALL of them, not just the first one!

6. TOTALS SECTION:
   - Subtotal
   - Discount total
   - Shipping charges
   - Tax (IGST or CGST+SGST with rates)
   - GRAND TOTAL

7. BANK DETAILS:
   - Account Number
   - IFSC Code
   - Bank Name & Branch
   - UPI ID

8. TERMS & NOTES

Convert: "₹32,250.4" → 32250.4, "12-May-2021" → "2021-05-12"
RETURN ONLY JSON.`;

const RULES_AND_FORMAT = `
STRICT OUTPUT RULES:
- Return ONLY valid JSON - NO markdown, NO explanations
- If field not found, use null
- Numbers: Remove ₹, $, commas → pure numbers
- Dates: Convert to YYYY-MM-DD format

REQUIRED JSON SCHEMA:

{
  "vendor_name": string | null,
  "vendor_gst_number": string | null,
  "vendor_address": string | null,
  "vendor_phone": string | null,
  "vendor_email": string | null,
  "vendor_website": string | null,
  
  "invoice_number": string | null,
  "invoice_date": string | null,
  "due_date": string | null,
  "po_number": string | null,
  "eway_bill_number": string | null,
  "vehicle_number": string | null,
  
  "buyer_name": string | null,
  "buyer_gst_number": string | null,
  "buyer_address": string | null,
  
  "shipping_name": string | null,
  "shipping_address": string | null,
  
  "currency": string | null,
  
  "subtotal": number | null,
  "discount": number | null,
  "discount_percentage": number | null,
  "shipping": number | null,
  "tax": number | null,
  "total": number | null,
  "amount_in_words": string | null,
  
  "igst_rate": number | null,
  "igst_amount": number | null,
  "cgst_rate": number | null,
  "cgst_amount": number | null,
  "sgst_rate": number | null,
  "sgst_amount": number | null,
  
  "bank_name": string | null,
  "bank_branch": string | null,
  "account_number": string | null,
  "ifsc_code": string | null,
  "upi_id": string | null,
  
  "line_items": [
    {
      "description": string | null,
      "hsn_code": string | null,
      "quantity": number | null,
      "unit": string | null,
      "unit_price": number | null,
      "discount": number | null,
      "discount_percentage": number | null,
      "tax": number | null,
      "tax_rate": number | null,
      "line_total": number | null
    }
  ],
  
  "terms_and_conditions": string | null,
  "notes": string | null
}

CRITICAL JSON RULES:
- ALL values must be literal numbers or strings - NO EXPRESSIONS
- If "tax" should be calculated as price * rate / 100, CALCULATE IT and return the number (e.g., 456.5)
- NEVER return: "tax": 2535.0 * 18.0 / 100  ❌ WRONG
- ALWAYS return: "tax": 456.3  ✅ CORRECT
- Calculate all amounts: subtotal, discount, tax, line_total BEFORE returning JSON
- Numbers MUST NOT contain ₹, $, commas, or expressions

DATE EXAMPLES: "12-May-2021" → "2021-05-12", "15/03/24" → "2024-03-15"
NUMBER EXAMPLES: "₹32,250.4" → 32250.4, "18%" → 18, tax calculation: (2535 * 18 / 100) → 456.3
`;

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // Remove currency symbols/letters, keep digits, minus, dot, and commas.
  // Then remove commas and parse.
  const cleaned = trimmed.replace(/[^0-9,.-]/g, "").replace(/,/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toNullablePercent(value: unknown): number | null {
  // Accept "18%" or "18" and treat as numeric percent (18)
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const cleaned = trimmed.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toNullableIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeCurrency(value: unknown): string | null {
  const s = toNullableString(value);
  if (!s) return null;
  const upper = s.toUpperCase();
  // Common cases
  if (upper.includes("INR") || upper.includes("₹")) return "INR";
  if (upper.includes("USD") || upper.includes("$")) return "USD";
  if (upper.includes("EUR") || upper.includes("€")) return "EUR";
  if (/^[A-Z]{3}$/.test(upper)) return upper;
  return null;
}

function normalizeInvoiceData(input: unknown) {
  const obj = (input && typeof input === "object") ? (input as Record<string, unknown>) : {};
  const rawItems = Array.isArray(obj.line_items) ? (obj.line_items as unknown[]) : [];

  return {
    // Vendor Information
    vendor_name: toNullableString(obj.vendor_name),
    vendor_gst_number: toNullableString(obj.vendor_gst_number),
    vendor_address: toNullableString(obj.vendor_address),
    vendor_phone: toNullableString(obj.vendor_phone),
    vendor_email: toNullableString(obj.vendor_email),
    vendor_website: toNullableString(obj.vendor_website),
    
    // Invoice Details
    invoice_number: toNullableString(obj.invoice_number),
    invoice_date: toNullableIsoDate(obj.invoice_date),
    due_date: toNullableIsoDate(obj.due_date),
    po_number: toNullableString(obj.po_number),
    eway_bill_number: toNullableString(obj.eway_bill_number),
    vehicle_number: toNullableString(obj.vehicle_number),
    currency: normalizeCurrency(obj.currency),
    
    // Buyer Information (Bill To)
    buyer_name: toNullableString(obj.buyer_name),
    buyer_gst_number: toNullableString(obj.buyer_gst_number),
    buyer_address: toNullableString(obj.buyer_address),
    
    // Shipping Information (Ship To)
    shipping_name: toNullableString(obj.shipping_name),
    shipping_address: toNullableString(obj.shipping_address),
    
    // Financial Summary
    subtotal: toNullableNumber(obj.subtotal),
    discount: toNullableNumber(obj.discount),
    discount_percentage: toNullableNumber(obj.discount_percentage),
    shipping: toNullableNumber(obj.shipping),
    tax: toNullableNumber(obj.tax),
    total: toNullableNumber(obj.total),
    amount_in_words: toNullableString(obj.amount_in_words),
    
    // GST Tax Breakdown
    igst_rate: toNullablePercent(obj.igst_rate),
    igst_amount: toNullableNumber(obj.igst_amount),
    cgst_rate: toNullablePercent(obj.cgst_rate),
    cgst_amount: toNullableNumber(obj.cgst_amount),
    sgst_rate: toNullablePercent(obj.sgst_rate),
    sgst_amount: toNullableNumber(obj.sgst_amount),
    
    // Bank Details
    bank_name: toNullableString(obj.bank_name),
    bank_branch: toNullableString(obj.bank_branch),
    account_number: toNullableString(obj.account_number),
    ifsc_code: toNullableString(obj.ifsc_code),
    upi_id: toNullableString(obj.upi_id),
    
    // Additional Information
    terms_and_conditions: toNullableString(obj.terms_and_conditions),
    notes: toNullableString(obj.notes),
    
    // Line Items with full details
    line_items: rawItems
      .map((it) => (it && typeof it === "object") ? (it as Record<string, unknown>) : {})
      .map((it) => ({
        description: toNullableString(it.description),
        hsn_code: toNullableString(it.hsn_code),
        quantity: toNullableNumber(it.quantity),
        unit: toNullableString(it.unit),
        unit_price: toNullableNumber(it.unit_price),
        discount: toNullableNumber(it.discount),
        discount_percentage: toNullableNumber(it.discount_percentage),
        tax: toNullableNumber(it.tax),
        tax_rate: toNullableNumber(it.tax_rate),
        line_total: toNullableNumber(it.line_total),
      })),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, ocrText, apiKey, model } = body;

    // Accept either image (for Vision API) or ocrText (for LLM parsing of OCR)
    if (!image && !ocrText) {
      return NextResponse.json(
        { error: "Missing image or ocrText in request" },
        { status: 400 }
      );
    }

    // Allow server-side API key from environment if not provided in request
    const effectiveApiKey = apiKey ?? process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY;
    if (!effectiveApiKey) {
      return NextResponse.json({ error: "No OpenRouter API key configured. Set OPENROUTER_API_KEY in your environment." }, { status: 400 });
    }

    const chosenModel = typeof model === "string" && model.trim().length > 0
      ? model.trim()
      : DEFAULT_MODEL;

    // Basic request logging for debugging
    try {
      console.info("/api/extract-invoice - request", {
        model: chosenModel,
        mode: ocrText ? "ocr_text" : "image",
        dataLength: ocrText ? ocrText.length : (typeof image === "string" ? image.length : undefined),
      });
    } catch {
      // ignore logging errors
    }

    // OpenRouter API call (compatible with OpenAI format)
    async function callOpenRouter(modelName: string) {
      // Build user message content based on mode
      if (image) {
        // Image mode: send image to Vision API
        const imageUserContent = [
          {
            type: "text",
            text: IMAGE_USER_PROMPT + "\n\n" + RULES_AND_FORMAT,
          },
          {
            type: "image_url",
            image_url: {
              url: image,
            },
          },
        ];

        return fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${effectiveApiKey}`,
            "HTTP-Referer": request.headers.get("referer") || "",
            "X-Title": "SnapToSheet",
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              {
                role: "system",
                content: SYSTEM_PROMPT,
              },
              {
                role: "user",
                content: imageUserContent,
              },
            ],
          }),
        });
      } else {
        // OCR text mode: send raw text for LLM to parse
        const userPrompt = OCR_USER_PROMPT.replace("{OCR_TEXT}", ocrText);
        const ocrUserContent = [
          {
            type: "text",
            text: userPrompt + "\n\n" + RULES_AND_FORMAT,
          },
        ];
        
        return fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${effectiveApiKey}`,
            "HTTP-Referer": request.headers.get("referer") || "",
            "X-Title": "SnapToSheet",
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              {
                role: "system",
                content: SYSTEM_PROMPT,
              },
              {
                role: "user",
                content: ocrUserContent,
              },
            ],
          }),
        });
      }
    }

    // Try chosen model first; on 404 for image input, retry with a vision-capable default
    let response;
    try {
      response = await callOpenRouter(chosenModel);
    } catch (err: any) {
      console.error("OpenRouter fetch failed:", err?.message ?? err, err?.stack ?? "");
      // Return a more descriptive error to make debugging easier during development
      return NextResponse.json(
        {
          error: "Failed to contact OpenRouter",
          details: (err && err.message) ? String(err.message).slice(0, 1000) : String(err).slice(0, 1000),
        },
        { status: 502 }
      );
    }

    // If response is not OK, read the body once and reuse the text for diagnostics.
    let responseErrorText: string | null = null;
    if (!response.ok) {
      try {
        responseErrorText = await response.text();
      } catch (err) {
        console.warn("Failed to read error body from OpenRouter response:", err);
      }

      // Detect the specific OpenRouter message about image support and retry with default vision model
      if (
        response.status === 404 &&
        responseErrorText &&
        /no endpoints found that support image input/i.test(responseErrorText) &&
        chosenModel !== DEFAULT_MODEL
      ) {
        // retry with DEFAULT_MODEL
        try {
          response = await callOpenRouter(DEFAULT_MODEL);
          // reset cached error text for the new response
          responseErrorText = null;
        } catch (retryErr: unknown) {
          const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          const stack = retryErr instanceof Error ? retryErr.stack : "";
          console.error("Retry with default model failed:", msg, stack);
          return NextResponse.json({ error: "Failed to contact OpenRouter on retry", details: msg.slice(0,1000) }, { status: 502 });
        }
      }
    }

    if (!response.ok) {
      // Use previously-read text when available, otherwise read now.
      const errorText = responseErrorText ?? (await (async () => {
        try { return await response.text(); } catch { return "<unavailable>"; }
      })());

      // Map common upstream errors to clearer client messages
      const isPayment = response.status === 402;
      const isImageUnsupported = /no endpoints found that support image input/i.test(errorText);
      const isDataPolicy = /data policy/i.test(errorText);

      const message = isPayment
        ? "Payment required or invalid OpenRouter key/model. Add credit or use a free/allowed model."
        : isImageUnsupported
          ? `Model does not support image input. Try a vision-capable model such as ${DEFAULT_MODEL}.`
          : isDataPolicy
            ? "Your OpenRouter data policy blocks this free model. Update privacy settings or choose a paid/allowed model."
            : `API error: ${errorText}`;

      const statusCode = isPayment ? 402 : 502; // surface upstream failures as 502 to avoid front-end 404 noise

      return NextResponse.json(
        { error: message, hint: String(errorText).slice(0,1000) },
        { status: statusCode }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: "No response from API" },
        { status: 500 }
      );
    }

    // The model may return JSON wrapped in markdown fences or extra text.
    try {
      let raw = content;

      // If the model returned an array/object already, accept it
      if (typeof raw === "object") {
        return NextResponse.json({ data: normalizeInvoiceData(raw) });
      }

      // Normalize string
      raw = String(raw).trim();

      // Strip triple-backtick fences and optional language marker
      raw = raw.replace(/^```\s*json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      
      // Fix common JSON issues from LLM responses:
      raw = raw.replace(/:\s*([0-9.]+)\s*\*\s*([0-9.]+)\s*\/\s*([0-9.]+)\s*([,\n}])/g, (match: string, a: string, b: string, c: string, end: string) => {
        const result = (parseFloat(a) * parseFloat(b) / parseFloat(c)).toFixed(2);
        return `: ${result}${end}`;
      });
      
      // Also handle simpler multiplication cases: number * number
      raw = raw.replace(/:\s*([0-9.]+)\s*\*\s*([0-9.]+)\s*([,\n}])/g, (match: string, a: string, b: string, end: string) => {
        const result = (parseFloat(a) * parseFloat(b)).toFixed(2);
        return `: ${result}${end}`;
      });

      // Find the first JSON object in the string
      const firstBrace = raw.indexOf("{");
      if (firstBrace === -1) {
        throw new Error("No JSON object found in response");
      }

      // Try to parse incrementally from the first brace, finding the matching closing brace
      let braceCount = 0;
      let inString = false;      let escapeNext = false;
      let endIndex = -1;

      for (let i = firstBrace; i < raw.length; i++) {
        const char = raw[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === "\\") {
          escapeNext = true;
          continue;
        }

        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === "{") {
            braceCount++;
          } else if (char === "}") {
            braceCount--;
            if (braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }
      }

      if (endIndex === -1) {
        // Fallback to last brace if smart parsing failed
        const lastBrace = raw.lastIndexOf("}");
        if (lastBrace === -1) {
          throw new Error("Could not find closing brace in JSON");
        }
        endIndex = lastBrace + 1;
      }

      const candidate = raw.slice(firstBrace, endIndex);
      const parsed = JSON.parse(candidate);
      const normalized = normalizeInvoiceData(parsed);

      // Heuristic fixes and fallbacks to improve accuracy
      // 1) If invoice number or invoice date missing, try to extract from OCR text
      function extractInvoiceNumberFromText(text?: string): string | null {
        if (!text) return null;
        // common patterns: INV-000125, Invoice No: 1234, Invoice #: 1234
        const patterns = [ /INV[-\s:]*([A-Za-z0-9-]+)/i, /Invoice\s*(No\.?|Number\:?|#)\s*[:\-\s]*([A-Za-z0-9-]+)/i, /Bill\s*(No\.?|#)\s*[:\-\s]*([A-Za-z0-9-]+)/i ];
        for (const p of patterns) {
          const m = text.match(p);
          if (m) {
            // capture may be in group 1 or 2 depending on pattern
            const g = m[1] && m[1].match(/^[A-Za-z0-9-]+$/) ? m[1] : (m[2] || m[1]);
            if (g) return g.trim();
          }
        }
        return null;
      }

      function extractFirstDateFromText(text?: string): string | null {
        if (!text) return null;
        // find date-like tokens
        const dateRegex = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\b/g;
        let m: RegExpExecArray | null;
        while ((m = dateRegex.exec(text))) {
          const candidate = m[1];
          const iso = toNullableIsoDate(candidate);
          if (iso) return iso;
        }
        return null;
      }

      // If invoice number missing or suspicious (very short numeric), try OCR fallback
      if (!normalized.invoice_number || /^\d{1,6}$/.test(normalized.invoice_number)) {
        const fallbackInv = extractInvoiceNumberFromText(ocrText as string | undefined);
        if (fallbackInv) normalized.invoice_number = normalized.invoice_number ?? fallbackInv;
      }

      if (!normalized.invoice_date) {
        const fallbackDate = extractFirstDateFromText(ocrText as string | undefined);
        if (fallbackDate) normalized.invoice_date = fallbackDate;
      }

      // 2) Recompute totals from line items if totals look wrong or missing
      try {
        const li = Array.isArray(normalized.line_items) ? normalized.line_items : [];
        if (li.length > 0) {
          // compute subtotal as sum of (unit_price * quantity) when available
          let computedSubtotal = 0;
          let computedDiscount = 0;
          let computedTax = 0;
          for (const item of li) {
            const qty = Number(item.quantity ?? 1);
            const up = Number(item.unit_price ?? item.line_total ?? 0);
            const lineBase = (Number.isFinite(qty) ? qty : 1) * (Number.isFinite(up) ? up : 0);
            computedSubtotal += lineBase;
            computedDiscount += Number(item.discount ?? 0);
            computedTax += Number(item.tax ?? 0);
          }
          const computedShipping = Number(normalized.shipping ?? 0);
          const computedTotal = computedSubtotal - computedDiscount + computedShipping + computedTax;

          // If normalized.total missing or deviates significantly, override with computed
          if (normalized.total == null || Math.abs((normalized.total as number) - computedTotal) > 1) {
            normalized.subtotal = Number.isFinite(computedSubtotal) ? Number(Number(computedSubtotal).toFixed(2)) : normalized.subtotal;
            normalized.discount = Number.isFinite(computedDiscount) ? Number(Number(computedDiscount).toFixed(2)) : normalized.discount;
            normalized.tax = Number.isFinite(computedTax) ? Number(Number(computedTax).toFixed(2)) : normalized.tax;
            normalized.total = Number.isFinite(computedTotal) ? Number(Number(computedTotal).toFixed(2)) : normalized.total;
            // append a note that totals were inferred
            const note = `Totals inferred from ${li.length} line items.`;
            normalized.notes = (normalized.notes ? normalized.notes + "\n" : "") + note;
          }
        }
      } catch (err) {
        // continue even if computation fails
        console.warn("Totals recomputation failed:", err);
      }

      // 3) If line_items missing or empty but OCR text clearly contains table-like markers, try a focused retry to the LLM for only line_items
      if ((!normalized.line_items || normalized.line_items.length === 0) && typeof ocrText === "string" && /(qty|quantity|description|hsn|rate|amount)/i.test(ocrText)) {
        try {
          console.info("No line items extracted — attempting focused retry for line_items");
          const lineItemPrompt = `The previous response missed the invoice line items. From the OCR text below, return ONLY a JSON array named "line_items" containing objects with fields: description, hsn_code, quantity, unit, unit_price, discount, discount_percentage, tax, tax_rate, line_total. Use literal numbers, no expressions. OCR:\n\n${ocrText}`;
          const retryResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${effectiveApiKey}`,
              "HTTP-Referer": request.headers.get("referer") || "",
              "X-Title": "SnapToSheet - retry-lineitems",
            },
            body: JSON.stringify({
              model: chosenModel,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: lineItemPrompt + "\n\n" + RULES_AND_FORMAT },
              ],
            }),
          });

          if (retryResp.ok) {
            const rdata = await retryResp.json();
            const rcontent = rdata.choices?.[0]?.message?.content;
            if (rcontent) {
              let rraw = String(rcontent).replace(/^```\s*json\s*/i, "").replace(/```$/i, "").trim();
              const firstB = rraw.indexOf("[");
              if (firstB !== -1) {
                const lastB = rraw.lastIndexOf("]");
                if (lastB !== -1) {
                  const arrText = rraw.slice(firstB, lastB + 1);
                  try {
                    const parsedItems = JSON.parse(arrText);
                    if (Array.isArray(parsedItems) && parsedItems.length > 0) {
                      normalized.line_items = parsedItems.map((it: any) => ({
                        description: toNullableString(it.description),
                        hsn_code: toNullableString(it.hsn_code),
                        quantity: toNullableNumber(it.quantity),
                        unit: toNullableString(it.unit),
                        unit_price: toNullableNumber(it.unit_price),
                        discount: toNullableNumber(it.discount),
                        discount_percentage: toNullableNumber(it.discount_percentage),
                        tax: toNullableNumber(it.tax),
                        tax_rate: toNullableNumber(it.tax_rate),
                        line_total: toNullableNumber(it.line_total),
                      }));
                    }
                  } catch (err) {
                    console.warn("Retry parse of line_items failed", err);
                  }
                }
              }
            }
          }
        } catch (err) {
          console.warn("Focused retry for line_items failed:", err);
        }
      }
      
      // Log the result for debugging
      console.info("/api/extract-invoice - extraction result", {
        vendor_name: normalized.vendor_name,
        invoice_number: normalized.invoice_number,
        subtotal: normalized.subtotal,
        total: normalized.total,
        line_items_count: normalized.line_items?.length || 0,
        line_items: normalized.line_items?.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
          line_total: it.line_total,
        })),
      });
      
      return NextResponse.json({ data: normalized });
    } catch {
      // Log the raw content for debugging and return a helpful error to the client
      console.error("Failed to parse model response as JSON:", { content });
      const safeContent = String(content).slice(0, 1000);
      return NextResponse.json(
        { error: `Failed to parse invoice data. Raw response: ${safeContent}` },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Unhandled error in /api/extract-invoice:", error);
    const isProd = process.env.NODE_ENV === "production";
    const message = error instanceof Error ? error.message : "Unknown error";
    const stack = error instanceof Error && error.stack ? error.stack : undefined;
    return NextResponse.json(
      isProd
        ? { error: message }
        : { error: message, stack },
      { status: 500 }
    );
  }
}
