import { useState } from 'react';
import { motion } from 'motion/react';
import { QrCode, Check, X, Smartphone, Package } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '../ui/input-otp';
import { toast } from 'sonner';

interface VerificationResult {
  success: boolean;
  itemName?: string;
  imageUrl?: string | null;
  recipientName?: string;
  message?: string;
}

interface HandshakeTerminalProps {
  onVerify: (code: string) => Promise<VerificationResult>;
  onRedeem?: (code: string) => Promise<boolean>;
  mode: 'customer' | 'merchant';
  customerCode?: string;
}

export function HandshakeTerminal({
  onVerify,
  onRedeem,
  mode,
  customerCode = 'ABCD-EFGH',
}: HandshakeTerminalProps) {
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'ready' | 'success' | 'error'>('idle');
  const [verifiedItem, setVerifiedItem] = useState<VerificationResult | null>(null);

  const handleVerify = async () => {
    if (code.length !== 8) {
      toast.error('Please enter the complete code');
      return;
    }

    setIsVerifying(true);
    setVerificationStatus('idle');
    setVerifiedItem(null);

    try {
      const result = await onVerify(code);

      if (result.success) {
        setVerificationStatus('ready');
        setVerifiedItem(result);
        toast.success('Gift verified', {
          description: result.message || 'Confirm the item image, then redeem the gift.',
        });
      } else {
        setVerificationStatus('error');
        toast.error('Invalid code', {
          description: result.message || 'Please check and try again',
        });
      }
    } catch (error) {
      setVerificationStatus('error');
      toast.error('Verification failed');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRedeem = async () => {
    if (!onRedeem || !verifiedItem) return;

    setIsRedeeming(true);
    // OPTIMISTIC UPDATE
    const previousStatus = verificationStatus;
    setVerificationStatus('success');

    try {
      const success = await onRedeem(code);

      if (success) {
        if ('vibrate' in navigator) {
          navigator.vibrate([100, 50, 100]);
        }
        toast.success('Handshake verified!', {
          description: 'Escrow released successfully',
        });
      } else {
        // Revert on logical failure
        setVerificationStatus(previousStatus);
        toast.error('Redemption failed', {
          description: 'Please verify the code again',
        });
      }
    } catch (error) {
      // Revert on error
      setVerificationStatus(previousStatus);
      toast.error('Redemption failed');
    } finally {
      setIsRedeeming(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#F97316] to-[#FB923C]">
          <Smartphone className="h-8 w-8 text-white" strokeWidth={1.5} />
        </div>
        <h2 className="font-light text-black">
          {mode === 'merchant' ? 'Verify Gift Code' : 'Your Gift Code'}
        </h2>
        <p className="text-sm font-light text-muted-foreground">
          {mode === 'merchant'
            ? 'Enter the 8-character code from the customer'
            : 'Show this code to the merchant to claim your gift'}
        </p>
      </div>

      {mode === 'merchant' ? (
        <div className="space-y-4">
          <div className="flex justify-center">
            <InputOTP
              maxLength={8}
              value={code}
              onChange={setCode}
              onComplete={handleVerify}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} className="h-14 w-12 text-lg font-mono" />
                <InputOTPSlot index={1} className="h-14 w-12 text-lg font-mono" />
                <InputOTPSlot index={2} className="h-14 w-12 text-lg font-mono" />
                <InputOTPSlot index={3} className="h-14 w-12 text-lg font-mono" />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={4} className="h-14 w-12 text-lg font-mono" />
                <InputOTPSlot index={5} className="h-14 w-12 text-lg font-mono" />
                <InputOTPSlot index={6} className="h-14 w-12 text-lg font-mono" />
                <InputOTPSlot index={7} className="h-14 w-12 text-lg font-mono" />
              </InputOTPGroup>
            </InputOTP>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleVerify}
            disabled={code.length !== 8 || isVerifying || isRedeeming}
            className="w-full rounded-full bg-gradient-to-r from-[#F97316] to-[#FB923C] py-3 font-light text-white shadow-lg transition-all hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isVerifying ? 'Verifying...' : 'Verify Code'}
          </motion.button>

          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <p className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[#F97316]">
              Item to Hand Over
            </p>

            {verifiedItem ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-2xl border border-orange-100 bg-white">
                  {verifiedItem.imageUrl ? (
                    <img
                      src={verifiedItem.imageUrl}
                      alt={verifiedItem.itemName}
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-gray-50">
                      <div className="text-center text-muted-foreground">
                        <Package className="mx-auto h-10 w-10 text-gray-400" />
                        <p className="mt-3 text-sm">No product image available</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-center">
                  <p className="font-medium text-black">{verifiedItem.itemName}</p>
                  {verifiedItem.recipientName && (
                    <p className="text-sm text-muted-foreground">
                      Recipient: {verifiedItem.recipientName}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-orange-200 bg-white/80 px-4 py-8 text-center text-sm text-muted-foreground">
                Validate a gift code to load the product image here before redemption.
              </div>
            )}
          </div>

          <motion.button
            whileHover={verifiedItem ? { scale: 1.02 } : undefined}
            whileTap={verifiedItem ? { scale: 0.98 } : undefined}
            onClick={handleRedeem}
            disabled={!verifiedItem || !onRedeem || isVerifying || isRedeeming}
            className="w-full rounded-full border border-border bg-white py-3 font-light text-black transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRedeeming ? 'Redeeming...' : 'Redeem Gift'}
          </motion.button>

          {verificationStatus !== 'idle' && verificationStatus !== 'ready' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-center justify-center gap-2 rounded-lg p-3 ${
                verificationStatus === 'success'
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {verificationStatus === 'success' ? (
                <>
                  {isRedeeming ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-green-700 border-t-transparent" />
                  ) : (
                    <Check className="h-5 w-5" strokeWidth={1.5} />
                  )}
                  <span className="font-light">
                    {isRedeeming ? 'Confirming Redemption...' : 'Redeemed Successfully'}
                  </span>
                </>
              ) : (
                <>
                  <X className="h-5 w-5" strokeWidth={1.5} />
                  <span className="font-light">Invalid Code</span>
                </>
              )}
            </motion.div>
          )}

          <div className="border-t border-border pt-4">
            <button className="flex w-full items-center justify-center gap-2 rounded-full border border-border py-3 font-light transition-colors hover:bg-gray-50">
              <QrCode className="h-5 w-5" strokeWidth={1.5} />
              Scan QR Code Instead
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="mx-auto flex aspect-square max-w-xs items-center justify-center rounded-[1rem] border-2 border-border bg-white p-6">
            <div className="space-y-4 text-center">
              <QrCode className="mx-auto h-32 w-32 text-black" strokeWidth={1} />
              <p className="text-xs font-light text-muted-foreground">
                High-contrast QR code
              </p>
            </div>
          </div>

          <div className="rounded-[1rem] bg-gray-50 p-6 text-center">
            <p className="mb-3 text-xs font-light text-muted-foreground">
              Or enter manually
            </p>
            <div className="text-3xl font-mono tracking-widest">
              {customerCode}
            </div>
          </div>

          <button className="w-full rounded-full border border-border py-3 font-light transition-colors hover:bg-gray-50">
            Merchant won&apos;t accept my code?
          </button>
        </div>
      )}
    </div>
  );
}
