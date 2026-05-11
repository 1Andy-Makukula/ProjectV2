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
} from 'lucide-react';
import { motion } from 'motion/react';

type RedeemStatus = 'idle' | 'success' | 'invalid' | 'not_paid';

interface RedeemResult {
  status: RedeemStatus;
  itemName?: string;
  recipientName?: string;
  message?: string;
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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RedeemResult>({ status: 'idle' });
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
          video: {
            facingMode: { ideal: 'environment' },
          },
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
          if (!videoRef.current) {
            return;
          }

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

  const handleRedeem = async () => {
    if (!code || code.length !== 6) {
      setResult({
        status: 'invalid',
        message: 'Please enter a valid 6-character code',
      });
      return;
    }

    setLoading(true);

    try {
      // Get merchant's shop ID
      const { data: merchantShop, error: shopError } = await supabase
        .from('merchant_shops')
        .select('shop_id')
        .eq('user_id', profile?.id)
        .single();

      if (shopError) throw shopError;

      const myShopId = merchantShop.shop_id;

      // Find order by code
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id, shop_id, status, recipient_name, item:items(name)')
        .eq('code', code.toUpperCase())
        .single();

      if (orderError || !order) {
        setResult({
          status: 'invalid',
          message: 'This code is invalid or has already been used',
        });
        setLoading(false);
        return;
      }

      // Check if order belongs to this shop
      if (order.shop_id !== myShopId) {
        setResult({
          status: 'invalid',
          message: 'This gift is not for your shop',
        });
        setLoading(false);
        return;
      }

      // Check if order is paid
      if (order.status !== 'paid') {
        setResult({
          status: 'not_paid',
          message: 'This gift has not yet been paid for and cannot be redeemed',
        });
        setLoading(false);
        return;
      }

      // Mark as fulfilled
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          status: 'fulfilled',
          fulfilled_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      if (updateError) throw updateError;

      setResult({
        status: 'success',
        itemName: (order.item as any)?.name,
        recipientName: order.recipient_name,
      });
      setCode('');
    } catch (error: any) {
      console.error('Error redeeming gift:', error);
      setResult({
        status: 'invalid',
        message: error.message || 'Failed to redeem gift',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setResult({ status: 'idle' });
    setCode('');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-4">
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

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-6 py-12">
        {result.status === 'idle' && (
          <div className="bg-white rounded-2xl p-8 shadow-sm space-y-6">
            <div className="text-center mb-6">
              <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-4">
                <QrCode className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">Enter Gift Code</h2>
              <p className="text-muted-foreground">
                Ask the customer for their 6-character code or scan their QR code
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <Input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXXXX"
                  maxLength={6}
                  className="text-center text-3xl font-bold tracking-widest uppercase h-16"
                />
              </div>

              <Button
                onClick={handleRedeem}
                disabled={loading || code.length !== 6}
                className="w-full py-6 text-lg bg-gradient-to-r from-primary to-primary-light"
              >
                {loading ? 'Redeeming...' : 'Redeem Gift'}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => setScanOpen(true)}
                className="w-full py-6 text-lg"
              >
                <Camera className="w-5 h-5 mr-2" />
                Scan QR Code
              </Button>

              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  The code is case-insensitive and contains only letters and numbers
                </p>
              </div>
            </div>
          </div>
        )}

        {result.status === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-8 shadow-sm"
          >
            <div className="text-center space-y-6">
              <motion.div
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.6 }}
                className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mx-auto"
              >
                <CheckCircle2 className="w-12 h-12 text-green-600" />
              </motion.div>

              <div>
                <h2 className="text-2xl font-semibold mb-2 text-green-600">
                  Gift Redeemed Successfully!
                </h2>
                <p className="text-muted-foreground mb-4">
                  {result.itemName} for {result.recipientName}
                </p>
              </div>

              <Button
                onClick={handleReset}
                className="px-8 py-6 bg-gradient-to-r from-primary to-primary-light"
              >
                Redeem Another Gift
              </Button>
            </div>
          </motion.div>
        )}

        {result.status === 'invalid' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-8 shadow-sm"
          >
            <div className="text-center space-y-6">
              <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center mx-auto">
                <XCircle className="w-12 h-12 text-red-600" />
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-2 text-red-600">
                  Invalid Code
                </h2>
                <p className="text-muted-foreground">{result.message}</p>
              </div>

              <Button
                onClick={handleReset}
                variant="outline"
                className="px-8 py-6"
              >
                Try Again
              </Button>
            </div>
          </motion.div>
        )}

        {result.status === 'not_paid' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-8 shadow-sm"
          >
            <div className="text-center space-y-6">
              <div className="w-24 h-24 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
                <AlertCircle className="w-12 h-12 text-amber-600" />
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-2 text-amber-600">
                  Payment Pending
                </h2>
                <p className="text-muted-foreground">{result.message}</p>
              </div>

              <Button
                onClick={handleReset}
                variant="outline"
                className="px-8 py-6"
              >
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
                  handleRedeem();
                }}
                disabled={loading || code.length !== 6}
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
