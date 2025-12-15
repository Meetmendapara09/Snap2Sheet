export interface InvoiceLineItem {
  description: string | null;
  hsn_code: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  discount: number | null;
  discount_percentage: number | null;
  tax: number | null;
  tax_rate: number | null;
  line_total: number | null;
}

export interface InvoiceData {
  // Vendor/Seller Details
  vendor_name: string | null;
  vendor_gst_number: string | null;
  vendor_address: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  vendor_website: string | null;
  
  // Invoice Details
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  po_number: string | null;
  eway_bill_number: string | null;
  vehicle_number: string | null;
  
  // Buyer/Bill To Details
  buyer_name: string | null;
  buyer_gst_number: string | null;
  buyer_address: string | null;
  
  // Shipping Details 
  shipping_name: string | null;
  shipping_address: string | null;
  
  // Currency
  currency: string | null;
  
  // Amounts
  subtotal: number | null;
  discount: number | null;
  discount_percentage: number | null;
  shipping: number | null;
  tax: number | null;
  total: number | null;
  amount_in_words: string | null;
  
  // GST Breakdown
  igst_rate: number | null;
  igst_amount: number | null;
  cgst_rate: number | null;
  cgst_amount: number | null;
  sgst_rate: number | null;
  sgst_amount: number | null;
  
  // Bank Details
  bank_name: string | null;
  bank_branch: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  upi_id: string | null;
  
  // Line Items
  line_items: InvoiceLineItem[];
  
  // Metadata
  terms_and_conditions: string | null;
  notes: string | null;
}

// Browser-safe base64 encoder
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";
  const chunkSize = 0x8000; // 32KB chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export async function extractInvoiceData(
  imageFile: File,
  apiKey?: string
): Promise<InvoiceData> {
  // Convert file to base64 (browser-safe)
  const base64 = await fileToBase64(imageFile);
  const mimeType = imageFile.type || "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${base64}`;

  // Call our API route instead of directly calling OpenRouter
  const body: Record<string, unknown> = { image: dataUrl };
  if (apiKey) body.apiKey = apiKey;

  const response = await fetch("/api/extract-invoice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Extraction failed");
  }

  const result = await response.json();
  return result.data as InvoiceData;
}
