"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { InvoiceData } from "@/lib/invoice-extractor";
import Tesseract from "tesseract.js";
import type { WorkSheet } from "xlsx";

type ExtractionState =
  | { kind: "idle" }
  | { kind: "extracting"; status: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

export function OcrToExcel() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [state, setState] = useState<ExtractionState>({ kind: "idle" }); 

  const totalsCheck = useMemo(() => {
    if (!invoiceData) return null;

    const subtotal = invoiceData.subtotal;
    const extractedTotal = invoiceData.total;
    if (subtotal == null || extractedTotal == null) {
      return { kind: "unknown" as const, computedTotal: null as number | null, diff: null as number | null };
    }

    const discount = invoiceData.discount ?? 0;
    const shipping = invoiceData.shipping ?? 0;
    const tax = invoiceData.tax ?? 0;
    const computedTotal = subtotal - discount + shipping + tax;
    const diff = Math.abs(extractedTotal - computedTotal);
    const match = diff <= 0.01;
    return { kind: match ? ("match" as const) : ("mismatch" as const), computedTotal, diff };
  }, [invoiceData]);

  const canExtract = useMemo(() => !!file && state.kind !== "extracting", [file, state]);
  const canExport = useMemo(() => !!invoiceData && state.kind !== "extracting", [invoiceData, state]);

  const confidenceNote = useMemo(() => {
    if (!invoiceData || totalsCheck?.kind === "unknown") return null;
    if (totalsCheck?.kind === "match") {
      return { kind: "high" as const, label: "✓ Verified" };
    }
    return { kind: "med" as const, label: "⚠ Review Required" };
  }, [invoiceData, totalsCheck]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      setImageDataUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  async function tesseractExtract(imageFile: File, existingDataUrl?: string | null): Promise<{ text: string; dataUrl: string }> {
    const imageUrl = existingDataUrl
      ? existingDataUrl
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(imageFile);
        });

    let worker: any;
    try {
      setState({ kind: "extracting", status: "Initializing OCR…" });

      worker = await (Tesseract as any).createWorker({
        logger: (m: any) => {
          if (m?.status === "recognizing text") {
            setState({ kind: "extracting", status: `OCR: ${Math.round((m.progress ?? 0) * 100)}%` });
          } else if (m?.status) {
            const label = String(m.status).replace(/_/g, " ");
            setState({ kind: "extracting", status: label.charAt(0).toUpperCase() + label.slice(1) + "…" });
          }
        },
      });

      await worker.load();

      await worker.loadLanguage("eng");

      await worker.initialize("eng");

      await worker.setParameters({

        tessedit_pageseg_mode: String((Tesseract as any).PSM?.AUTO ?? 3),

        preserve_interword_spaces: "1",

        user_defined_dpi: "300",

        load_system_dawg: "F",
        load_freq_dawg: "F",
      });

      const { data } = await worker.recognize(imageUrl);

      await worker.terminate();
      worker = null;
      return { text: (data as any)?.text ?? "", dataUrl: imageUrl };
    } catch (err) {

      try {
        const result = await Tesseract.recognize(imageUrl, "eng", {
          logger: (m) => {
            if ((m as any).status === "recognizing text") {
              setState({ kind: "extracting", status: `OCR: ${Math.round(((m as any).progress ?? 0) * 100)}%` });
            }
          },
        });
        return { text: result.data.text, dataUrl: imageUrl };
      } finally {
        try {
          if (worker) {

            await worker.terminate();
          }
        } catch {}
      }
    }
  }

  async function extractInvoice() {
    if (!file) return;

    setInvoiceData(null);
    setState({ kind: "extracting", status: "Processing invoice…" });

    try {

      if (imageDataUrl) {
        setState({ kind: "extracting", status: "Analyzing invoice…" });
        const response = await fetch("/api/extract-invoice", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ image: imageDataUrl }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Extraction failed");
        }

        const result = await response.json();
        setInvoiceData(result.data as InvoiceData);
        setState({ kind: "done" });
        return;
      }

      setState({ kind: "extracting", status: "Running OCR…" });
      const { text: ocrText, dataUrl } = await tesseractExtract(file, imageDataUrl);

      setState({ kind: "extracting", status: "Parsing with AI…" });
      const response = await fetch("/api/extract-invoice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ocrText, image: dataUrl ?? imageDataUrl ?? undefined }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Extraction failed");
      }

      const result = await response.json();
      setInvoiceData(result.data as InvoiceData);
      setState({ kind: "done" });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Extraction failed";
      setState({ kind: "error", message });
    }
  }

  async function downloadExcel() {
  if (!invoiceData) return;

  const XLSX = await import("xlsx");

  type SheetCell = string | number | null | { f: string };

  function setColumnWidths(ws: WorkSheet, widths: number[]) {
    ws["!cols"] = widths.map((wch) => ({ wch }));
  }

  const wb = XLSX.utils.book_new();

    const summaryData: SheetCell[][] = [];

    summaryData.push(["INVOICE DETAILS", "", "", ""]);
    summaryData.push([]);

    summaryData.push(["VENDOR INFORMATION", "", "INVOICE INFORMATION", ""]);
    summaryData.push(["Vendor Name:", invoiceData.vendor_name ?? "N/A", "Invoice Number:", invoiceData.invoice_number ?? "N/A"]);
    summaryData.push(["GST Number:", invoiceData.vendor_gst_number ?? "N/A", "Invoice Date:", invoiceData.invoice_date ?? "N/A"]);
    summaryData.push(["Address:", invoiceData.vendor_address ?? "N/A", "Due Date:", invoiceData.due_date ?? "N/A"]);
    summaryData.push(["Phone:", invoiceData.vendor_phone ?? "N/A", "Currency:", invoiceData.currency ?? "INR"]);
    summaryData.push(["Email:", invoiceData.vendor_email ?? "N/A", "PO Number:", invoiceData.po_number ?? "N/A"]);
    summaryData.push(["Website:", invoiceData.vendor_website ?? "N/A", "E-way Bill:", invoiceData.eway_bill_number ?? "N/A"]);
    summaryData.push(["", "", "Vehicle No:", invoiceData.vehicle_number ?? "N/A"]);
    summaryData.push([]);

    summaryData.push(["BUYER INFORMATION (BILL TO)", "", "SHIPPING INFORMATION (SHIP TO)", ""]);
    summaryData.push(["Buyer Name:", invoiceData.buyer_name ?? "N/A", "Shipping Name:", invoiceData.shipping_name ?? invoiceData.buyer_name ?? "N/A"]);
    summaryData.push(["GST Number:", invoiceData.buyer_gst_number ?? "N/A", "Shipping Address:", invoiceData.shipping_address ?? invoiceData.buyer_address ?? "N/A"]);
    summaryData.push(["Address:", invoiceData.buyer_address ?? "N/A", "", ""]);
    summaryData.push([]);

    summaryData.push(["FINANCIAL SUMMARY", "", "", ""]);
    summaryData.push(["Item", "Amount", "", ""]);
    summaryData.push(["Subtotal", invoiceData.subtotal ?? 0, "", ""]);
    if (invoiceData.discount_percentage) {
      summaryData.push(["Less: Discount", invoiceData.discount ?? 0, `(${invoiceData.discount_percentage}%)`, ""]);
    } else {
      summaryData.push(["Less: Discount", invoiceData.discount ?? 0, "", ""]);
    }
    summaryData.push(["Add: Shipping/Freight", invoiceData.shipping ?? 0, "", ""]);

    const hasGST = invoiceData.igst_rate || invoiceData.cgst_rate || invoiceData.sgst_rate;
    if (hasGST) {
      summaryData.push([]);
      summaryData.push(["GST BREAKDOWN", "", "", ""]);
      summaryData.push(["Tax Type", "Rate (%)", "Amount", ""]);

      if (invoiceData.igst_rate != null) {
        summaryData.push(["IGST", invoiceData.igst_rate, invoiceData.igst_amount ?? 0, ""]);
      }
      if (invoiceData.cgst_rate != null) {
        summaryData.push(["CGST", invoiceData.cgst_rate, invoiceData.cgst_amount ?? 0, ""]);
      }
      if (invoiceData.sgst_rate != null) {
        summaryData.push(["SGST", invoiceData.sgst_rate, invoiceData.sgst_amount ?? 0, ""]);
      }
      summaryData.push([]);
    } else {
      summaryData.push(["Add: Tax/GST", invoiceData.tax ?? 0, "", ""]);
      summaryData.push([]);
    }

    summaryData.push(["TOTAL AMOUNT", invoiceData.total ?? 0, "", ""]);

    const computedTotal =
      (invoiceData.subtotal ?? 0) -
      (invoiceData.discount ?? 0) +
      (invoiceData.shipping ?? 0) +
      (invoiceData.tax ?? 0);

    summaryData.push([]);
    summaryData.push(["VERIFICATION", "", "", ""]);
    summaryData.push(["Extracted Total:", invoiceData.total ?? 0, "", ""]);
    summaryData.push(["Computed Total:", computedTotal, "", ""]);
    const diff = Math.abs((invoiceData.total ?? 0) - computedTotal);
    summaryData.push(["Difference:", diff, "", ""]);
    summaryData.push(["Status:", diff <= 0.01 ? "✓ VERIFIED" : "⚠ REVIEW REQUIRED", "", ""]);

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    setColumnWidths(wsSummary, [25, 15, 25, 15]);

    const range = XLSX.utils.decode_range(wsSummary["!ref"] || "A1");
    for (let R = 0; R <= range.e.r; R++) {
      for (let C = 1; C <= 2; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = wsSummary[addr];
        if (cell && typeof cell.v === "number") {
          cell.z = "#,##0.00";
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, wsSummary, "Invoice Summary");

    const lineItemsData: SheetCell[][] = [];

    lineItemsData.push(["LINE ITEMS BREAKDOWN"]);
    lineItemsData.push([]);
    lineItemsData.push(["#", "Description", "HSN/SAC Code", "Qty", "Unit", "Unit Price", "Discount", "Disc %", "Tax", "Tax %", "Line Total"]);

    invoiceData.line_items.forEach((item, idx) => {
      lineItemsData.push([
        idx + 1,
        item.description ?? "",
        item.hsn_code ?? "",
        item.quantity ?? 0,
        item.unit ?? "pcs",
        item.unit_price ?? 0,
        item.discount ?? 0,
        item.discount_percentage ?? "",
        item.tax ?? 0,
        item.tax_rate ?? "",
        item.line_total ?? 0,
      ]);
    });

    if (invoiceData.line_items.length > 0) {
      lineItemsData.push([]);
      const lastRow = lineItemsData.length;
      lineItemsData.push([
        "",
        "SUBTOTAL",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        { f: `SUM(K4:K${lastRow})` },
      ]);
    }

    const wsLineItems = XLSX.utils.aoa_to_sheet(lineItemsData);
    setColumnWidths(wsLineItems, [5, 35, 12, 8, 8, 12, 10, 8, 10, 8, 15]);

    const liRange = XLSX.utils.decode_range(wsLineItems["!ref"] || "A1");
    for (let R = 3; R <= liRange.e.r; R++) {
      for (let C = 3; C <= 10; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = wsLineItems[addr];
        if (cell && (typeof cell.v === "number" || cell.f)) {
          cell.z = C === 3 ? "0" : "#,##0.00";
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, wsLineItems, "Line Items");

    const auditData: SheetCell[][] = [];

    auditData.push(["AUDIT TRAIL & VERIFICATION"]);
    auditData.push([]);
    auditData.push(["Extraction Details"]);
    auditData.push(["Extraction Date:", new Date().toLocaleDateString()]);
    auditData.push(["Extraction Time:", new Date().toLocaleTimeString()]);
    auditData.push(["Method:", "OCR + AI LLM"]);
    auditData.push([]);

    auditData.push(["Data Quality Check"]);
    const fields = [
      ["Vendor Name", invoiceData.vendor_name],
      ["Vendor GST Number", invoiceData.vendor_gst_number],
      ["Vendor Address", invoiceData.vendor_address],
      ["Vendor Phone", invoiceData.vendor_phone],
      ["Vendor Email", invoiceData.vendor_email],
      ["Vendor Website", invoiceData.vendor_website],
      ["Buyer Name", invoiceData.buyer_name],
      ["Buyer GST Number", invoiceData.buyer_gst_number],
      ["Buyer Address", invoiceData.buyer_address],
      ["Shipping Name", invoiceData.shipping_name],
      ["Shipping Address", invoiceData.shipping_address],
      ["Invoice Number", invoiceData.invoice_number],
      ["Invoice Date", invoiceData.invoice_date],
      ["Due Date", invoiceData.due_date],
      ["PO Number", invoiceData.po_number],
      ["E-way Bill Number", invoiceData.eway_bill_number],
      ["Vehicle Number", invoiceData.vehicle_number],
      ["Currency", invoiceData.currency],
      ["Subtotal", invoiceData.subtotal],
      ["Discount", invoiceData.discount],
      ["Discount %", invoiceData.discount_percentage],
      ["Shipping", invoiceData.shipping],
      ["Tax", invoiceData.tax],
      ["IGST Rate", invoiceData.igst_rate],
      ["IGST Amount", invoiceData.igst_amount],
      ["CGST Rate", invoiceData.cgst_rate],
      ["CGST Amount", invoiceData.cgst_amount],
      ["SGST Rate", invoiceData.sgst_rate],
      ["SGST Amount", invoiceData.sgst_amount],
      ["Total", invoiceData.total],
      ["Amount in Words", invoiceData.amount_in_words],
      ["Bank Name", invoiceData.bank_name],
      ["Bank Branch", invoiceData.bank_branch],
      ["Account Number", invoiceData.account_number],
      ["IFSC Code", invoiceData.ifsc_code],
      ["UPI ID", invoiceData.upi_id],
      ["Terms & Conditions", invoiceData.terms_and_conditions],
      ["Notes", invoiceData.notes],
    ];

    auditData.push(["Field", "Status", "Value"]);
    fields.forEach(([field, value]) => {
      auditData.push([field, value != null ? "✓ Present" : "⚠ Missing", value ?? "N/A"]);
    });

    auditData.push([]);
    auditData.push(["Line Items", `${invoiceData.line_items.length} items extracted`]);

    if (invoiceData.line_items.length > 0) {
      auditData.push([]);
      auditData.push(["Line Item HSN Codes:"]);
      invoiceData.line_items.forEach((item, idx) => {
        auditData.push([`Item ${idx + 1}`, item.hsn_code ?? "N/A", item.description ?? ""]);
      });
    }

    auditData.push([]);
    auditData.push(["NOTES FOR ACCOUNTANT"]);
    auditData.push(["• Review all amounts for accuracy"]);
    auditData.push(["• Verify vendor details with purchase order"]);
    auditData.push(["• Check GST/tax calculations"]);
    auditData.push(["• Confirm line items match PO"]);
    auditData.push(["• Validate totals before posting to ledger"]);

    const wsAudit = XLSX.utils.aoa_to_sheet(auditData);
    setColumnWidths(wsAudit, [25, 20, 25]);

    XLSX.utils.book_append_sheet(wb, wsAudit, "Audit Trail");

    const accountingData: SheetCell[][] = [];

    accountingData.push(["SUGGESTED ACCOUNTING ENTRIES"]);
    accountingData.push([]);
    accountingData.push(["Account", "Description", "Debit", "Credit"]);

    accountingData.push([
      "Purchases A/c",
      `Invoice #${invoiceData.invoice_number ?? "N/A"} - ${invoiceData.vendor_name ?? "N/A"}`,
      invoiceData.subtotal ?? 0,
      "",
    ]);

    if (invoiceData.discount && invoiceData.discount > 0) {
      accountingData.push(["Discount Received A/c", "Discount on purchase", "", invoiceData.discount]);
    }

    if (invoiceData.shipping && invoiceData.shipping > 0) {
      accountingData.push(["Freight Inward A/c", "Shipping charges", invoiceData.shipping, ""]);
    }

    if (invoiceData.igst_amount && invoiceData.igst_amount > 0) {
      accountingData.push(["IGST Input A/c", `IGST @ ${invoiceData.igst_rate}%`, invoiceData.igst_amount, ""]);
    }
    if (invoiceData.cgst_amount && invoiceData.cgst_amount > 0) {
      accountingData.push(["CGST Input A/c", `CGST @ ${invoiceData.cgst_rate}%`, invoiceData.cgst_amount, ""]);
    }
    if (invoiceData.sgst_amount && invoiceData.sgst_amount > 0) {
      accountingData.push(["SGST Input A/c", `SGST @ ${invoiceData.sgst_rate}%`, invoiceData.sgst_amount, ""]);
    }
    if (invoiceData.tax && invoiceData.tax > 0 && !hasGST) {
      accountingData.push(["Tax Input A/c", "Input tax", invoiceData.tax, ""]);
    }

    accountingData.push([
      `${invoiceData.vendor_name ?? "Vendor"} A/c`,
      "Accounts Payable",
      "",
      invoiceData.total ?? 0,
    ]);

    accountingData.push([]);
    const lastAccRow = accountingData.length;
    accountingData.push([
      "",
      "TOTAL",
      { f: `SUM(C4:C${lastAccRow})` },
      { f: `SUM(D4:D${lastAccRow})` },
    ]);

    accountingData.push([]);
    accountingData.push(["Verification:", { f: `C${lastAccRow + 1}-D${lastAccRow + 1}` }, "", ""]);
    accountingData.push(["Note: Debit and Credit totals must be equal"]);

    const wsAccounting = XLSX.utils.aoa_to_sheet(accountingData);
    setColumnWidths(wsAccounting, [25, 45, 15, 15]);

    const accRange = XLSX.utils.decode_range(wsAccounting["!ref"] || "A1");
    for (let R = 3; R <= accRange.e.r; R++) {
      for (let C = 2; C <= 3; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = wsAccounting[addr];
        if (cell && (typeof cell.v === "number" || cell.f)) {
          cell.z = "#,##0.00";
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, wsAccounting, "Accounting Entries");

    const rawData: SheetCell[][] = [];

    rawData.push(["RAW DATA EXPORT (CSV-Compatible Format)"]);
    rawData.push([]);

    rawData.push(["VENDOR DETAILS", ""]);
    rawData.push(["Vendor Name", invoiceData.vendor_name ?? ""]);
    rawData.push(["Vendor GST Number", invoiceData.vendor_gst_number ?? ""]);
    rawData.push(["Vendor Address", invoiceData.vendor_address ?? ""]);
    rawData.push(["Vendor Phone", invoiceData.vendor_phone ?? ""]);
    rawData.push(["Vendor Email", invoiceData.vendor_email ?? ""]);
    rawData.push(["Vendor Website", invoiceData.vendor_website ?? ""]);
    rawData.push([]);

    rawData.push(["INVOICE DETAILS", ""]);
    rawData.push(["Invoice Number", invoiceData.invoice_number ?? ""]);
    rawData.push(["Invoice Date", invoiceData.invoice_date ?? ""]);
    rawData.push(["Due Date", invoiceData.due_date ?? ""]);
    rawData.push(["PO Number", invoiceData.po_number ?? ""]);
    rawData.push(["E-way Bill Number", invoiceData.eway_bill_number ?? ""]);
    rawData.push(["Vehicle Number", invoiceData.vehicle_number ?? ""]);
    rawData.push(["Currency", invoiceData.currency ?? "INR"]);
    rawData.push([]);

    rawData.push(["BUYER DETAILS", ""]);
    rawData.push(["Buyer Name", invoiceData.buyer_name ?? ""]);
    rawData.push(["Buyer GST Number", invoiceData.buyer_gst_number ?? ""]);
    rawData.push(["Buyer Address", invoiceData.buyer_address ?? ""]);
    rawData.push([]);

    rawData.push(["SHIPPING DETAILS", ""]);
    rawData.push(["Shipping Name", invoiceData.shipping_name ?? ""]);
    rawData.push(["Shipping Address", invoiceData.shipping_address ?? ""]);
    rawData.push([]);

    rawData.push(["FINANCIAL SUMMARY", ""]);
    rawData.push(["Subtotal", invoiceData.subtotal ?? 0]);
    rawData.push(["Discount", invoiceData.discount ?? 0]);
    rawData.push(["Discount Percentage", invoiceData.discount_percentage ?? ""]);
    rawData.push(["Shipping", invoiceData.shipping ?? 0]);
    rawData.push(["Tax", invoiceData.tax ?? 0]);
    rawData.push(["IGST Rate", invoiceData.igst_rate ?? ""]);
    rawData.push(["IGST Amount", invoiceData.igst_amount ?? 0]);
    rawData.push(["CGST Rate", invoiceData.cgst_rate ?? ""]);
    rawData.push(["CGST Amount", invoiceData.cgst_amount ?? 0]);
    rawData.push(["SGST Rate", invoiceData.sgst_rate ?? ""]);
    rawData.push(["SGST Amount", invoiceData.sgst_amount ?? 0]);
    rawData.push(["Total", invoiceData.total ?? 0]);
    rawData.push(["Amount in Words", invoiceData.amount_in_words ?? ""]);
    rawData.push([]);

    rawData.push(["BANK DETAILS", ""]);
    rawData.push(["Bank Name", invoiceData.bank_name ?? ""]);
    rawData.push(["Bank Branch", invoiceData.bank_branch ?? ""]);
    rawData.push(["Account Number", invoiceData.account_number ?? ""]);
    rawData.push(["IFSC Code", invoiceData.ifsc_code ?? ""]);
    rawData.push(["UPI ID", invoiceData.upi_id ?? ""]);
    rawData.push([]);

    rawData.push(["ADDITIONAL INFORMATION", ""]);
    rawData.push(["Terms & Conditions", invoiceData.terms_and_conditions ?? ""]);
    rawData.push(["Notes", invoiceData.notes ?? ""]);
    rawData.push([]);

    rawData.push(["LINE ITEMS"]);
    rawData.push(["Item#", "Description", "HSN Code", "Quantity", "Unit", "Unit Price", "Discount", "Disc %", "Tax", "Tax %", "Line Total"]);
    invoiceData.line_items.forEach((item, idx) => {
      rawData.push([
        idx + 1,
        item.description ?? "",
        item.hsn_code ?? "",
        item.quantity ?? 0,
        item.unit ?? "",
        item.unit_price ?? 0,
        item.discount ?? 0,
        item.discount_percentage ?? "",
        item.tax ?? 0,
        item.tax_rate ?? "",
        item.line_total ?? 0,
      ]);
    });

    const wsRaw = XLSX.utils.aoa_to_sheet(rawData);
    setColumnWidths(wsRaw, [25, 50, 12, 10, 8, 12, 10, 8, 10, 8, 15]);

    const rawRange = XLSX.utils.decode_range(wsRaw["!ref"] || "A1");
    for (let R = 0; R <= rawRange.e.r; R++) {
      for (let C = 1; C <= 10; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = wsRaw[addr];
        if (cell && typeof cell.v === "number") {
          cell.z = "#,##0.00";
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, wsRaw, "Raw Data");

    const fileName = `Invoice_${invoiceData.invoice_number ?? "Unknown"}_${invoiceData.vendor_name?.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20) ?? "Vendor"}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-4xl px-4 py-10">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">
            SnapToSheet
          </h1>
          <p className="mt-3 text-lg text-zinc-600">
            Turn invoice screenshots into Excel in one click.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border-2 border-dashed border-zinc-300 bg-white p-8">
          <div className="text-center">
            <label className="block text-base font-medium">Upload Invoice</label>
            <p className="mt-1 text-sm text-zinc-500">
              WhatsApp screenshot, photo, or scanned image
            </p>
          </div>
          <input
            className="mt-4 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-800"
            type="file"
            accept="image/*"
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              setFile(next);
              setInvoiceData(null);
              setState({ kind: "idle" });
            }}
          />

          {previewUrl ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
              <div className="relative aspect-4/3 w-full">
                <Image
                  src={previewUrl}
                  alt="Preview"
                  fill
                  className="object-contain"
                  unoptimized
                />
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              className="inline-flex h-12 items-center justify-center rounded-lg bg-emerald-600 px-6 text-base font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
              onClick={extractInvoice}
              disabled={!canExtract}
            >
              {state.kind === "extracting" ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {state.status}
                </>
              ) : (
                "Extract Invoice"
              )}
            </button>

            <button
              type="button"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-zinc-300 bg-white px-6 text-base font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 shadow-sm"
              onClick={downloadExcel}
              disabled={!canExport}
            >
              📥 Download Excel
            </button>
          </div>

          {state.kind === "extracting" && (
            <div className="mt-4 rounded-xl bg-zinc-50 p-4 text-center">
              <div className="text-sm font-medium text-zinc-700">{state.status}</div>
              <div className="mt-2">
                <div className="mx-auto h-1.5 w-48 overflow-hidden rounded-full bg-zinc-200">
                  <div className="h-full w-full animate-pulse bg-emerald-600" />
                </div>
              </div>
            </div>
          )}

          {state.kind === "error" && (
            <div className="mt-4 rounded-xl bg-red-50 p-4">
              <div className="text-sm font-medium text-red-800">{state.message}</div>
              {state.message.includes("model") || state.message.includes("policy") ? (
                <div className="mt-2 text-xs text-red-700">
                  <p className="font-semibold mb-1">Troubleshooting:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Ensure your OpenRouter API key is valid</li>
                    <li>Check your OpenRouter account has sufficient credits</li>
                    <li>Verify your privacy settings at openrouter.ai/settings/privacy</li>
                    <li>The app will automatically try alternative models</li>
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          {invoiceData && (
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Extracted Data Preview ✨</h3>
                {confidenceNote && (
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                      confidenceNote.kind === "high"
                        ? "bg-emerald-100 text-emerald-800"
                        : confidenceNote.kind === "med"
                          ? "bg-orange-100 text-orange-900"
                          : "bg-zinc-100 text-zinc-700"
                    }`}
                  >
                    {confidenceNote.label}
                  </span>
                )}
              </div>

              {}
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-zinc-200 p-3">
                  <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-2">Vendor Information</h4>
                  <div className="space-y-1 text-sm">
                    <div><span className="text-zinc-500">Name:</span> <span className="font-medium">{invoiceData.vendor_name ?? "—"}</span></div>
                    <div><span className="text-zinc-500">GST:</span> <span className="font-medium">{invoiceData.vendor_gst_number ?? "—"}</span></div>
                    <div><span className="text-zinc-500">Address:</span> <span className="font-medium">{invoiceData.vendor_address ?? "—"}</span></div>
                    {invoiceData.vendor_phone && <div><span className="text-zinc-500">Phone:</span> <span className="font-medium">{invoiceData.vendor_phone}</span></div>}
                    {invoiceData.vendor_email && <div><span className="text-zinc-500">Email:</span> <span className="font-medium">{invoiceData.vendor_email}</span></div>}
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 p-3">
                  <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-2">Invoice Details</h4>
                  <div className="space-y-1 text-sm">
                    <div><span className="text-zinc-500">Invoice #:</span> <span className="font-medium">{invoiceData.invoice_number ?? "—"}</span></div>
                    <div><span className="text-zinc-500">Date:</span> <span className="font-medium">{invoiceData.invoice_date ?? "—"}</span></div>
                    {invoiceData.due_date && <div><span className="text-zinc-500">Due Date:</span> <span className="font-medium">{invoiceData.due_date}</span></div>}
                    {invoiceData.po_number && <div><span className="text-zinc-500">PO #:</span> <span className="font-medium">{invoiceData.po_number}</span></div>}
                    {invoiceData.eway_bill_number && <div><span className="text-zinc-500">E-way Bill:</span> <span className="font-medium">{invoiceData.eway_bill_number}</span></div>}
                    {invoiceData.vehicle_number && <div><span className="text-zinc-500">Vehicle:</span> <span className="font-medium">{invoiceData.vehicle_number}</span></div>}
                  </div>
                </div>
              </div>

              {}
              {(invoiceData.buyer_name || invoiceData.shipping_name) && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-zinc-200 p-3">
                    <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-2">Buyer (Bill To)</h4>
                    <div className="space-y-1 text-sm">
                      <div><span className="text-zinc-500">Name:</span> <span className="font-medium">{invoiceData.buyer_name ?? "—"}</span></div>
                      <div><span className="text-zinc-500">GST:</span> <span className="font-medium">{invoiceData.buyer_gst_number ?? "—"}</span></div>
                      {invoiceData.buyer_address && <div><span className="text-zinc-500">Address:</span> <span className="font-medium">{invoiceData.buyer_address}</span></div>}
                    </div>
                  </div>

                  {invoiceData.shipping_name && (
                    <div className="rounded-xl border border-zinc-200 p-3">
                      <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-2">Shipping (Ship To)</h4>
                      <div className="space-y-1 text-sm">
                        <div><span className="text-zinc-500">Name:</span> <span className="font-medium">{invoiceData.shipping_name}</span></div>
                        {invoiceData.shipping_address && <div><span className="text-zinc-500">Address:</span> <span className="font-medium">{invoiceData.shipping_address}</span></div>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {}
              {invoiceData.line_items.length > 0 && (
                <div className="mt-3">
                  <h4 className="text-xs font-semibold section-heading uppercase mb-2">Line Items ({invoiceData.line_items.length})</h4>
                  <div className="overflow-x-auto rounded-xl border border-zinc-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-50">
                        <tr>
                          <th className="px-2 py-2 font-medium">#</th>
                          <th className="px-2 py-2 font-medium">Description</th>
                          <th className="px-2 py-2 font-medium">HSN</th>
                          <th className="px-2 py-2 font-medium text-right">Qty</th>
                          <th className="px-2 py-2 font-medium text-right">Rate</th>
                          <th className="px-2 py-2 font-medium text-right">Discount</th>
                          <th className="px-2 py-2 font-medium text-right">Tax</th>
                          <th className="px-2 py-2 font-medium text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {invoiceData.line_items.map((item, idx) => (
                          <tr key={idx}>
                            <td className="px-2 py-2">{idx + 1}</td>
                            <td className="px-2 py-2 max-w-50 truncate" title={item.description ?? ""}>{item.description ?? "—"}</td>
                            <td className="px-2 py-2">{item.hsn_code ?? "—"}</td>
                            <td className="px-2 py-2 text-right">{item.quantity ?? "—"} {item.unit ?? ""}</td>
                            <td className="px-2 py-2 text-right">{item.unit_price ?? "—"}</td>
                            <td className="px-2 py-2 text-right">{item.discount ?? "—"}{item.discount_percentage ? ` (${item.discount_percentage}%)` : ""}</td>
                            <td className="px-2 py-2 text-right">{item.tax ?? "—"}{item.tax_rate ? ` (${item.tax_rate}%)` : ""}</td>
                            <td className="px-2 py-2 text-right font-medium">{item.line_total ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {}
              <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50">
                    <tr>
                      <th className="px-4 py-3 font-medium">Financial Summary</th>
                      <th className="px-4 py-3 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    <tr>
                      <td className="px-4 py-2 text-zinc-600">Subtotal</td>
                      <td className="px-4 py-2 text-right font-medium">{invoiceData.subtotal ?? "—"}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-zinc-600">Discount {invoiceData.discount_percentage ? `(${invoiceData.discount_percentage}%)` : ""}</td>
                      <td className="px-4 py-2 text-right font-medium text-red-600">-{invoiceData.discount ?? "0"}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-zinc-600">Tax</td>
                      <td className="px-4 py-2 text-right font-medium">{invoiceData.tax ?? "—"}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-zinc-600">Shipping</td>
                      <td className="px-4 py-2 text-right font-medium">{invoiceData.shipping ?? "—"}</td>
                    </tr>
                    <tr className="bg-green-50">
                      <td className="px-4 py-3 font-semibold text-zinc-900">Total Amount</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <div className="text-lg font-bold text-green-700">
                            {invoiceData.total ? `${invoiceData.currency ?? "INR"} ${invoiceData.total}` : "—"}
                          </div>
                          {totalsCheck?.kind === "match" && (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                              ✓ Verified
                            </span>
                          )}
                          {totalsCheck?.kind === "mismatch" && (
                            <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900">
                              ⚠ Mismatch
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {}
              {(invoiceData.bank_name || invoiceData.account_number || invoiceData.ifsc_code || invoiceData.upi_id) && (
                <div className="mt-3 rounded-xl border border-zinc-200 p-3">
                  <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-2">Bank Details</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    {invoiceData.bank_name && <div><span className="text-zinc-500">Bank:</span> <span className="font-medium">{invoiceData.bank_name}</span></div>}
                    {invoiceData.bank_branch && <div><span className="text-zinc-500">Branch:</span> <span className="font-medium">{invoiceData.bank_branch}</span></div>}
                    {invoiceData.account_number && <div><span className="text-zinc-500">A/C:</span> <span className="font-medium">{invoiceData.account_number}</span></div>}
                    {invoiceData.ifsc_code && <div><span className="text-zinc-500">IFSC:</span> <span className="font-medium">{invoiceData.ifsc_code}</span></div>}
                    {invoiceData.upi_id && <div><span className="text-zinc-500">UPI:</span> <span className="font-medium">{invoiceData.upi_id}</span></div>}
                  </div>
                </div>
              )}

              {}
              {(invoiceData.igst_rate ||
                invoiceData.igst_amount ||
                invoiceData.cgst_rate ||
                invoiceData.cgst_amount ||
                invoiceData.sgst_rate ||
                invoiceData.sgst_amount) && (
                <div className="mt-3 rounded-xl border border-zinc-200 p-3">
                  <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-2">GST Breakdown</h4>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    {invoiceData.igst_rate != null && (
                      <div><span className="text-zinc-500">IGST @ {invoiceData.igst_rate}%:</span> <span className="font-medium">{invoiceData.igst_amount ?? "—"}</span></div>
                    )}
                    {invoiceData.cgst_rate != null && (
                      <div><span className="text-zinc-500">CGST @ {invoiceData.cgst_rate}%:</span> <span className="font-medium">{invoiceData.cgst_amount ?? "—"}</span></div>
                    )}
                    {invoiceData.sgst_rate != null && (
                      <div><span className="text-zinc-500">SGST @ {invoiceData.sgst_rate}%:</span> <span className="font-medium">{invoiceData.sgst_amount ?? "—"}</span></div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500">
          No login required. No history saved. One click extract, one click download.
        </p>
      </div>
    </div>
  );
}

