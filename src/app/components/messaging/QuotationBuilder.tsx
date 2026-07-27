// QuotationBuilder — the merchant's side of pricing custom work.

import { useState } from 'react';
import { Plus, Trash2, FileText, X } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../../utils/errorParser';
import { toCents } from '../../../utils/currency';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';

interface DraftLine {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

interface QuotationBuilderProps {
  conversationId: string;
  onClose: () => void;
  onSent?: () => void;
}

const newLine = (): DraftLine => ({
  key: Math.random().toString(36).slice(2),
  description: '',
  quantity: '1',
  unitPrice: '',
});

export function QuotationBuilder({ conversationId, onClose, onSent }: QuotationBuilderProps) {
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [notes, setNotes] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);

  const total = lines.reduce((sum, l) => {
    const qty = parseInt(l.quantity, 10);
    const unit = parseFloat(l.unitPrice);
    if (!Number.isFinite(qty) || !Number.isFinite(unit)) return sum;
    return sum + qty * unit;
  }, 0);

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const handleSend = async () => {
    const payload = lines
      .map((l) => ({
        description: l.description.trim(),
        quantity: parseInt(l.quantity, 10),
        unit_price_zmw: toCents(parseFloat(l.unitPrice)),
      }))
      .filter((l) => l.description.length > 0);

    if (payload.length === 0) {
      toast.error('Add at least one line with a description');
      return;
    }
    if (payload.some((l) => !Number.isFinite(l.quantity) || l.quantity < 1)) {
      toast.error('Every line needs a quantity of at least 1');
      return;
    }
    if (payload.some((l) => !Number.isFinite(l.unit_price_zmw) || l.unit_price_zmw <= 0)) {
      toast.error('Every line needs a price');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('create_quotation', {
        p_conversation_id: conversationId,
        p_line_items: payload,
        p_notes: notes.trim() || null,
        p_valid_until: validUntil ? new Date(validUntil).toISOString() : null,
        p_target_execution_date: targetDate ? new Date(targetDate).toISOString() : null,
      });
      if (error) throw error;

      toast.success('Quotation sent');
      onSent?.();
      onClose();
    } catch (err: any) {
      toast.error(parseAuthError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-slate-200 bg-slate-50/80 px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">
          <FileText className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
          Build a quotation
        </h3>
        <button
          onClick={onClose}
          className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
          aria-label="Close quotation builder"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={line.key} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              {index === 0 && (
                <Label className="mb-1 block text-[11px] text-slate-500">Description</Label>
              )}
              <Input
                value={line.description}
                onChange={(e) => updateLine(line.key, { description: e.target.value })}
                placeholder="e.g. Two-tier cake"
                className="h-9 bg-white"
              />
            </div>
            <div className="w-16 shrink-0">
              {index === 0 && <Label className="mb-1 block text-[11px] text-slate-500">Qty</Label>}
              <Input
                type="number"
                min="1"
                value={line.quantity}
                onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                className="h-9 bg-white"
              />
            </div>
            <div className="w-28 shrink-0">
              {index === 0 && (
                <Label className="mb-1 block text-[11px] text-slate-500">Unit (ZMW)</Label>
              )}
              <Input
                type="number"
                min="0"
                step="0.01"
                value={line.unitPrice}
                onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                placeholder="0.00"
                className="h-9 bg-white"
              />
            </div>
            <button
              type="button"
              onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
              disabled={lines.length === 1}
              className="mb-0.5 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-200 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Remove line"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setLines((prev) => [...prev, newLine()])}
        className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary-light"
      >
        <Plus className="h-3.5 w-3.5" />
        Add line
      </button>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="mb-1 block text-[11px] text-slate-500">Scheduled for (optional)</Label>
          <Input
            type="datetime-local"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="h-9 bg-white"
          />
        </div>
        <div>
          <Label className="mb-1 block text-[11px] text-slate-500">Quote valid until (optional)</Label>
          <Input
            type="datetime-local"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="h-9 bg-white"
          />
        </div>
      </div>

      <div className="mt-3">
        <Label className="mb-1 block text-[11px] text-slate-500">Notes (optional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything the customer should know before accepting"
          className="bg-white"
        />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Total</p>
          <p className="text-lg font-light tracking-tight text-slate-900 tabular-nums">
            ZMW {total.toFixed(2)}
          </p>
        </div>
        <Button onClick={handleSend} disabled={saving || total <= 0}>
          {saving ? 'Sending…' : 'Send quotation'}
        </Button>
      </div>
    </div>
  );
}
