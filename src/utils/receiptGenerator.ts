/**
 * receiptGenerator.ts
 * Shared utility for generating printable KithLy transaction receipts.
 * Works for both Merchant Fulfillment receipts and Sender payment receipts.
 */

export interface ReceiptData {
  shopName: string;
  itemName: string;
  /** Amount in lowest denomination (Ngwee). Will be converted to ZMW. */
  amountNgwee: number;
  currency?: string;
  claimCode: string;
  recipientName: string;
  fulfilledAt?: string | null;
  paidAt?: string | null;
  txRef?: string | null;
}

/** Converts Ngwee → ZMW and formats as a currency string. */
function formatZMW(ngwee: number): string {
  return `ZMW ${(ngwee / 100).toFixed(2)}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-ZM', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Generates the receipt HTML as a string. */
export function buildReceiptHTML(data: ReceiptData): string {
  const {
    shopName,
    itemName,
    amountNgwee,
    claimCode,
    recipientName,
    fulfilledAt,
    paidAt,
    txRef,
  } = data;

  const dateLabel = fulfilledAt
    ? `Fulfilled At: ${formatDate(fulfilledAt)}`
    : paidAt
    ? `Paid At: ${formatDate(paidAt)}`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>KithLy Receipt — ${claimCode}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #fff; color: #111; padding: 40px; max-width: 480px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 32px; }
    .logo { font-size: 28px; font-weight: 700; color: #f97316; letter-spacing: -0.5px; }
    .subtitle { font-size: 13px; color: #888; margin-top: 4px; }
    .divider { border: none; border-top: 1px solid #eee; margin: 20px 0; }
    .section-label { font-size: 11px; font-weight: 600; color: #aaa; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
    .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .row .key { color: #666; }
    .row .val { font-weight: 600; text-align: right; max-width: 55%; }
    .code-block { background: #fff7ed; border: 2px dashed #f97316; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .code-block .code { font-size: 36px; font-weight: 700; font-family: monospace; color: #f97316; letter-spacing: 0.25em; }
    .code-block .code-label { font-size: 12px; color: #aaa; margin-top: 6px; }
    .amount { font-size: 22px; font-weight: 700; color: #111; }
    .footer { text-align: center; font-size: 11px; color: #bbb; margin-top: 32px; line-height: 1.6; }
    .badge { display: inline-block; background: #dcfce7; color: #16a34a; border-radius: 99px; padding: 2px 12px; font-size: 12px; font-weight: 600; margin-top: 4px; }
    @media print {
      body { padding: 20px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">KithLy</div>
    <div class="subtitle">Escrow Gift Receipt</div>
  </div>

  <div class="section-label">Transaction Details</div>
  <div class="row"><span class="key">Shop</span><span class="val">${shopName}</span></div>
  <div class="row"><span class="key">Gift Item</span><span class="val">${itemName}</span></div>
  <div class="row"><span class="key">Recipient</span><span class="val">${recipientName}</span></div>
  <div class="row"><span class="key">Amount</span><span class="val amount">${formatZMW(amountNgwee)}</span></div>
  ${dateLabel ? `<div class="row"><span class="key">${dateLabel.split(':')[0]}</span><span class="val">${dateLabel.split(': ')[1]}</span></div>` : ''}
  ${txRef ? `<div class="row"><span class="key">Ref</span><span class="val" style="font-size:11px;color:#aaa">${txRef}</span></div>` : ''}

  <hr class="divider" />

  <div class="code-block">
    <div class="code-label">Claim Code</div>
    <div class="code">${claimCode}</div>
    ${fulfilledAt ? '<div class="badge">✓ Gift Fulfilled</div>' : ''}
  </div>

  <hr class="divider" />

  <div class="footer">
    This is an official KithLy transaction receipt.<br/>
    Payment is securely held in escrow until the recipient collects the gift.<br/>
    <strong>KithLy Escrow Protection</strong>
  </div>
</body>
</html>`;
}

/**
 * Opens the receipt in a new browser tab and triggers the print dialog.
 * The user can then Save as PDF from the print dialog.
 */
export function printReceipt(data: ReceiptData): void {
  const html = buildReceiptHTML(data);
  const win = window.open('', '_blank', 'width=560,height=800');
  if (!win) {
    console.error('[receiptGenerator] Could not open print window — popup may be blocked.');
    return;
  }
  win.document.write(html);
  win.document.close();
  // Small delay so fonts/styles load before the print dialog opens
  setTimeout(() => {
    win.focus();
    win.print();
  }, 400);
}
