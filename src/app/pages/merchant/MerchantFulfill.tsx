import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { supabase } from '../../../utils/supabase/client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Badge } from '../../components/ui/badge';
import {
  ArrowLeft,
  QrCode,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Camera,
  Package,
} from 'lucide-react';
import { motion } from 'motion/react';

type RedeemStatus = 'idle' | 'ready' | 'success' | 'invalid' | 'not_paid';

interface VerifiedOrder {
  id: string;
  shop_id: string;
  recipient_name: string;
  item_name: string;
  item_image_url: string | null;
}

interface RedeemResult {
  status: RedeemStatus;
  itemName?: string;
  recipientName?: string;
  message?: string;
  itemImageUrl?: string | null;
}

type DetectedCode = {
  rawValue?: string;
};

type BarcodeDetectorInstance = {
  detect: (input: ImageBitmapSource) => Promise<DetectedCode[]>;
};

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorInstance;

export function MerchantFulfill() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [code, setCode] = useState('');
  const [action, setAction] = useState<'verify' | 'redeem' | null>(null);
  const [result, setResult] = useState<RedeemResult>({ status: 'idle' });
  const [verifiedOrder, setVerifiedOrder] = useState<VerifiedOrder | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanSupported, setScanSupported] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    setScanSupported(
      typeof window !== 'undefined' &&
        'BarcodeDetector' in window &&
        typeof window.BarcodeDetector === 'function',
    );
  }, []);

  useEffect(() => {
    if (!scanOpen) {
      stopScanner();
      return;
    }

    if (!scanSupported) {
      setScanError('QR scanning is not supported on this device. Enter the code manually.');
      return;
    }

    let cancelled = false;

    const startScanner = async () => {
      try {
        setScanError('');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const Detector = window.BarcodeDetector as BarcodeDetectorConstructor;
        const detector = new Detector({ formats: ['qr_code'] });

        const scanFrame = async () => {
          if (!videoRef.current) return;

          try {
            if (videoRef.current.readyState >= 2) {
              const detections = await detector.detect(videoRef.current);
              const detectedValue = detections.find((entry) => entry.rawValue)?.rawValue;

              if (detectedValue) {
                const normalizedCode = detectedValue
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, 6);

                if (normalizedCode.length === 6) {
                  setCode(normalizedCode);
                  setScanOpen(false);
                  return;
                }
              }
            }
          } catch (error) {
            console.error('QR scan error:', error);
          }

          frameRef.current = window.requestAnimationFrame(scanFrame);
        };

        frameRef.current = window.requestAnimationFrame(scanFrame);
      } catch (error: any) {
        console.error('Error starting scanner:', error);
        setScanError(
          error?.message || 'Camera access was denied. Enter the code manually instead.',
        );
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [scanOpen, scanSupported]);

  const stopScanner = () => {
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const handleVerify = async () => {
    if (!code || code.length !== 6) {
      setVerifiedOrder(null);
      setResult({
        status: 'invalid',
        message: 'Please enter a valid 6-character code',
      });
      return;
    }

    setAction('verify');
    setVerifiedOrder(null);
    setResult({ status: 'idle' });

    try {
      const { data: merchantShop, error: shopError } = await supabase
        .from('merchant_shops')
        .select('shop_id')
        .eq('user_id', profile?.id)
        .single();

      if (shopError) throw shopError;

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, shop_id, status, recipient_name, items(name, image_url)')
        .eq('code', code.toUpperCase())
        .single();

      if (orderError || !order) {
        setResult({
          status: 'invalid',
          message: 'This code is invalid or has already been used',
        });
        return;
      }

      if (order.shop_id !== merchantShop.shop_id) {
        setResult({
          status: 'invalid',
          message: 'This gift is not for your shop',
        });
        return;
      }

      if (order.status !== 'paid') {
        setResult({
          status: 'not_paid',
          message: 'This gift has not yet been paid for and cannot be redeemed',
        });
        return;
      }

      const normalizedOrder = {
        id: order.id,
        shop_id: order.shop_id,
        recipient_name: order.recipient_name,
        item_name: (order.items as any)?.name || 'Unknown item',
        item_image_url: (order.items as any)?.image_url || null,
      };

      setVerifiedOrder(normalizedOrder);
      setResult({
        status: 'ready',
        itemName: normalizedOrder.item_name,
        recipientName: normalizedOrder.recipient_name,
        itemImageUrl: normalizedOrder.item_image_url,
        message: 'Item verified. Confirm the handover, then redeem the gift.',
      });
    } catch (error: any) {
      console.error('Error verifying gift:', error);
      setResult({
        status: 'invalid',
        message: error.message || 'Failed to verify gift',
      });
    } finally {
      setAction(null);
    }
  };

  const handleRedeem = async () => {
    if (!verifiedOrder) return;

    setAction('redeem');

    try {
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'fulfilled',
          fulfilled_at: new Date().toISOString(),
        })
        .eq('id', verifiedOrder.id);

      if (error) throw error;

      setResult({
        status: 'success',
        itemName: verifiedOrder.item_name,
        recipientName: verifiedOrder.recipient_name,
        itemImageUrl: verifiedOrder.item_image_url,
      });
      setCode('');
      setVerifiedOrder(null);
    } catch (error: any) {
      console.error('Error redeeming gift:', error);
      setResult({
        status: 'invalid',
        message: error.message || 'Failed to redeem gift',
      });
    } finally {
      setAction(null);
    }
  };

  const handleReset = () => {
    setCode('');
    setVerifiedOrder(null);
    setResult({ status: 'idle' });
  };

  const verificationPreview = verifiedOrder ?? (
    result.status === 'success'
      ? {
          id: 'fulfilled',
          shop_id: '',
          recipient_name: result.recipientName || '',
          item_name: result.itemName || 'Gift',
          item_image_url: result.itemImageUrl || null,
        }
      : null
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-6 py-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/merchant')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-semibold">Redeem a Gift</h1>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-6 py-12">
        {(result.status === 'idle' || result.status === 'ready') && (
          <div className="space-y-6 rounded-2xl bg-white p-8 shadow-sm">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-orange-100">
                <QrCode className="w-10 h-10 text-primary" />
              </div>
              <h2 className="mb-2 text-2xl font-semibold">Verify Gift Code</h2>
              <p className="text-muted-foreground">
                Confirm the live order, inspect the item image, then redeem the gift.
              </p>
            </div>

            <div className="space-y-4">
              <Input
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="XXXXXX"
                maxLength={6}
                className="h-16 text-center text-3xl font-bold uppercase tracking-widest"
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  onClick={handleVerify}
                  disabled={action !== null || code.length !== 6}
                  className="w-full py-6 text-lg bg-gradient-to-r from-primary to-primary-light"
                >
                  {action === 'verify' ? 'Verifying...' : 'Verify Code'}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setScanOpen(true)}
                  className="w-full py-6 text-lg"
                >
                  <Camera className="mr-2 h-5 w-5" />
                  Scan QR Code
                </Button>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                The current live order system uses a 6-character collection code.
              </p>
            </div>

            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5">
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary/80">
                Item to Hand Over
              </p>

              {verifiedOrder ? (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-orange-100 bg-white">
                    {verifiedOrder.item_image_url ? (
                      <img
                        src={verifiedOrder.item_image_url}
                        alt={verifiedOrder.item_name}
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

                  <div className="space-y-1">
                    <h3 className="text-xl font-semibold text-gray-900">
                      {verifiedOrder.item_name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Recipient: {verifiedOrder.recipient_name}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-orange-200 bg-white/70 px-4 py-8 text-center text-sm text-muted-foreground">
                  Verify a valid code to load the live product image here before redemption.
                </div>
              )}
            </div>

            {result.status === 'ready' && result.message && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                {result.message}
              </div>
            )}

            <Button
              onClick={handleRedeem}
              disabled={!verifiedOrder || action !== null}
              className="w-full py-6 text-lg bg-gradient-to-r from-primary to-primary-light"
            >
              {action === 'redeem' ? 'Redeeming...' : 'Redeem Gift'}
            </Button>
          </div>
        )}

        {result.status === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl bg-white p-8 shadow-sm"
          >
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-green-100">
                <CheckCircle2 className="h-12 w-12 text-green-600" />
              </div>

              {verificationPreview && (
                <div className="mx-auto max-w-sm overflow-hidden rounded-2xl border border-green-100 bg-gray-50">
                  {verificationPreview.item_image_url ? (
                    <img
                      src={verificationPreview.item_image_url}
                      alt={verificationPreview.item_name}
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center">
                      <Package className="h-10 w-10 text-gray-400" />
                    </div>
                  )}
                </div>
              )}

              <div>
                <h2 className="mb-2 text-2xl font-semibold text-green-600">
                  Gift Redeemed Successfully
                </h2>
                <p className="text-muted-foreground">
                  {result.itemName} for {result.recipientName}
                </p>
              </div>

              <Button
                onClick={handleReset}
                className="bg-gradient-to-r from-primary to-primary-light px-8 py-6"
              >
                Redeem Another Gift
              </Button>
            </div>
          </motion.div>
        )}

        {result.status === 'invalid' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl bg-white p-8 shadow-sm"
          >
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-red-100">
                <XCircle className="h-12 w-12 text-red-600" />
              </div>
              <div>
                <h2 className="mb-2 text-2xl font-semibold text-red-600">Invalid Code</h2>
                <p className="text-muted-foreground">{result.message}</p>
              </div>
              <Button onClick={handleReset} variant="outline" className="px-8 py-6">
                Try Again
              </Button>
            </div>
          </motion.div>
        )}

        {result.status === 'not_paid' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl bg-white p-8 shadow-sm"
          >
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-amber-100">
                <AlertCircle className="h-12 w-12 text-amber-600" />
              </div>
              <div>
                <h2 className="mb-2 text-2xl font-semibold text-amber-600">Payment Pending</h2>
                <p className="text-muted-foreground">{result.message}</p>
              </div>
              <Button onClick={handleReset} variant="outline" className="px-8 py-6">
                Try Another Code
              </Button>
            </div>
          </motion.div>
        )}
      </div>

      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Scan Recipient QR Code</DialogTitle>
            <DialogDescription>
              Hold the recipient&apos;s QR code steady inside the frame and we&apos;ll fill in the gift code automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={scanError ? 'destructive' : 'secondary'}>
                {scanError ? 'Camera issue' : scanSupported ? 'Camera active' : 'Unsupported'}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {scanError
                  ? scanError
                  : scanSupported
                    ? 'Point the rear camera at the QR code.'
                    : 'Manual code entry is still available below.'}
              </p>
            </div>

            <div className="relative overflow-hidden rounded-2xl border bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="aspect-video w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 border-[18px] border-black/30" />
              <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]" />
            </div>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setScanOpen(false)}
                className="flex-1"
              >
                Close Scanner
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setScanOpen(false);
                  handleVerify();
                }}
                disabled={action !== null || code.length !== 6}
                className="flex-1 bg-gradient-to-r from-primary to-primary-light"
              >
                Use {code || 'Scanned Code'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
