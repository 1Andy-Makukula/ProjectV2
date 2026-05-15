import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { supabase } from '../../../utils/supabase/client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { ArrowLeft, Store } from 'lucide-react';
import { motion } from 'motion/react';
import { formatCurrency } from '../../../utils/currency';

interface Item {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  image_url: string | null;
  shop_id: string;
  is_available: boolean;
}

interface Shop {
  id: string;
  name: string;
}

interface SendFlowData {
  recipientName: string;
  recipientPhone: string;
  message: string;
}

export function SendFlow() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<Item | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState<SendFlowData>({
    recipientName: '',
    recipientPhone: '+260',
    message: '',
  });
  const [errors, setErrors] = useState<Partial<SendFlowData>>({});

  useEffect(() => {
    fetchItemDetails();
  }, [itemId]);

  const fetchItemDetails = async () => {
    if (!itemId) return;

    try {
      // Fetch item details
      const { data: itemData, error: itemError } = await supabase
        .from('items')
        .select('*')
        .eq('id', itemId)
        .single();

      if (itemError) throw itemError;
      setItem(itemData);

      // Fetch shop details
      const { data: shopData, error: shopError } = await supabase
        .from('shops')
        .select('id, name')
        .eq('id', itemData.shop_id)
        .single();

      if (shopError) throw shopError;
      setShop(shopData);
    } catch (error) {
      console.error('Error fetching item details:', error);
    } finally {
      setLoading(false);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<SendFlowData> = {};

    if (!formData.recipientName.trim()) {
      newErrors.recipientName = 'Recipient name is required';
    }

    if (!formData.recipientPhone.trim()) {
      newErrors.recipientPhone = 'Recipient phone is required';
    } else if (formData.recipientPhone.trim().length < 4) {
      newErrors.recipientPhone = 'Please enter a valid phone number';
    }

    if (formData.message.length > 200) {
      newErrors.message = 'Message must be 200 characters or less';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleContinue = () => {
    if (!validateForm() || !item || !shop) return;

    // Store the send flow data and navigate to summary
    const sendData = {
      item,
      shop,
      ...formData,
    };

    // Store in sessionStorage for the summary page
    sessionStorage.setItem('sendFlowData', JSON.stringify(sendData));
    navigate('/summary');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!item || !shop) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-medium mb-2">Item Not Found</h2>
          <p className="text-muted-foreground mb-6">
            This item doesn't exist or is no longer available.
          </p>
          <Button onClick={() => navigate('/home')}>Go Back Home</Button>
        </div>
      </div>
    );
  }

  if (!item.is_available) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-medium mb-2">Item Unavailable</h2>
          <p className="text-muted-foreground mb-6">
            This item is currently unavailable for purchase.
          </p>
          <Button onClick={() => navigate(`/shop/${item.shop_id}`)}>
            Back to Shop
          </Button>
        </div>
      </div>
    );
  }

  const messageCharsRemaining = 200 - formData.message.length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/shop/${item.shop_id}`)}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-semibold">Send Gift</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Item Summary Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card>
            <CardContent className="p-4">
              <div className="flex gap-4">
                {/* Item Image */}
                <div className="w-24 h-24 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Store className="w-8 h-8 text-gray-400" />
                    </div>
                  )}
                </div>

                {/* Item Details */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg mb-1">{item.name}</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    from {shop.name}
                  </p>
                  <p className="text-lg font-bold text-primary">
                    {formatCurrency(item.price, item.currency)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Recipient Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Recipient Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Recipient Name */}
              <div>
                <label
                  htmlFor="recipientName"
                  className="block text-sm font-medium mb-2"
                >
                  Recipient Name <span className="text-red-500">*</span>
                </label>
                <Input
                  id="recipientName"
                  type="text"
                  placeholder="Enter recipient's full name"
                  value={formData.recipientName}
                  onChange={(e) =>
                    setFormData({ ...formData, recipientName: e.target.value })
                  }
                  aria-invalid={!!errors.recipientName}
                />
                {errors.recipientName && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.recipientName}
                  </p>
                )}
              </div>

              {/* Sender Phone */}
              <div>
                <label
                  htmlFor="recipientPhone"
                  className="block text-sm font-medium mb-2"
                >
                  Sender Phone <span className="text-red-500">*</span>
                </label>
                <Input
                  id="recipientPhone"
                  type="tel"
                  placeholder="+260 XXX XXX XXX"
                  value={formData.recipientPhone}
                  onChange={(e) =>
                    setFormData({ ...formData, recipientPhone: e.target.value })
                  }
                  aria-invalid={!!errors.recipientPhone}
                />
                {errors.recipientPhone && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.recipientPhone}
                  </p>
                )}
              </div>

              {/* Message */}
              <div>
                <label
                  htmlFor="message"
                  className="block text-sm font-medium mb-2"
                >
                  Personal Message{' '}
                  <span className="text-muted-foreground font-normal">
                    (Optional)
                  </span>
                </label>
                <Textarea
                  id="message"
                  placeholder="Add a personal message for the recipient..."
                  value={formData.message}
                  onChange={(e) =>
                    setFormData({ ...formData, message: e.target.value })
                  }
                  rows={4}
                  maxLength={200}
                  aria-invalid={!!errors.message}
                />
                <div className="flex justify-between items-center mt-1">
                  {errors.message ? (
                    <p className="text-sm text-red-500">{errors.message}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Make it special with a heartfelt message
                    </p>
                  )}
                  <p
                    className={`text-sm ${messageCharsRemaining < 20
                      ? 'text-orange-500'
                      : 'text-muted-foreground'
                      }`}
                  >
                    {messageCharsRemaining} characters remaining
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Continue Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Button
            onClick={handleContinue}
            className="w-full h-12 text-base font-medium bg-gradient-to-r from-primary to-primary-light"
          >
            Continue to Summary
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
