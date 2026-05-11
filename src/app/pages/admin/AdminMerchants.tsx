import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Plus, Key, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { supabase } from '../../../utils/supabase/client';
import { callServer } from '../../../utils/server';
import { toast } from 'sonner';

interface Merchant {
  id: string;
  name: string;
  email: string;
  created_at: string;
  shop_name?: string;
}

interface Shop {
  id: string;
  name: string;
}

export function AdminMerchants() {
  const navigate = useNavigate();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    shopId: '',
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // Generate random password when dialog opens
    if (dialogOpen) {
      setFormData({
        name: '',
        email: '',
        password: generatePassword(),
        shopId: '',
      });
    }
  }, [dialogOpen]);

  const generatePassword = () => {
    const length = 12;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
  };

  const loadData = async () => {
    try {
      setLoading(true);

      // Load all users with merchant role
      const { data: merchantsData, error: merchantsError } = await supabase
        .from('users')
        .select('*')
        .eq('role', 'merchant')
        .order('created_at', { ascending: false });

      if (merchantsError) throw merchantsError;

      // Load shops
      const { data: shopsData, error: shopsError } = await supabase
        .from('shops')
        .select('id, name')
        .order('name');

      if (shopsError) throw shopsError;
      setShops(shopsData || []);

      // Get shop assignments for each merchant
      const merchantsWithShops = await Promise.all(
        (merchantsData || []).map(async (merchant) => {
          const { data: assignment } = await supabase
            .from('merchant_shops')
            .select('shop:shops(name)')
            .eq('user_id', merchant.id)
            .single();

          return {
            id: merchant.id,
            name: merchant.name,
            email: merchant.email,
            created_at: merchant.created_at,
            shop_name: assignment?.shop?.name || 'No shop assigned',
          };
        })
      );

      setMerchants(merchantsWithShops);
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast.error('Failed to load merchants');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateMerchant = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.email || !formData.password || !formData.shopId) {
      toast.error('Please fill in all fields');
      return;
    }

    setSubmitting(true);
    try {
      await callServer('/merchants', {
        body: {
          name: formData.name,
          email: formData.email,
          password: formData.password,
          shopId: formData.shopId,
        },
      });

      toast.success('Merchant account created successfully');
      toast.info(`Temporary password: ${formData.password}`, { duration: 10000 });
      setDialogOpen(false);
      loadData();
    } catch (error: any) {
      console.error('Error creating merchant:', error);
      toast.error(error.message || 'Failed to create merchant account');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);

      if (error) throw error;

      toast.success(`Password reset email sent to ${email}`);
    } catch (error: any) {
      console.error('Error sending reset email:', error);
      toast.error('Failed to send password reset email');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/90 text-white">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/admin')}
              className="text-white hover:bg-white/10"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-light">Manage Merchants</h1>
              <p className="text-sm opacity-90 font-light">Create and manage merchant accounts</p>
            </div>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-white text-primary hover:bg-white/90">
                <Plus className="w-5 h-5" />
                Create Merchant Account
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreateMerchant}>
                <DialogHeader>
                  <DialogTitle>Create Merchant Account</DialogTitle>
                  <DialogDescription>
                    Create a new merchant account and assign them to a shop.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Enter merchant name"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="merchant@example.com"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Temporary Password *</Label>
                    <div className="flex gap-2">
                      <Input
                        id="password"
                        type="text"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        placeholder="Auto-generated password"
                        required
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setFormData({ ...formData, password: generatePassword() })}
                      >
                        <Key className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Share this password with the merchant. They can change it after first login.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="shop">Assign to Shop *</Label>
                    <Select
                      value={formData.shopId}
                      onValueChange={(value) => setFormData({ ...formData, shopId: value })}
                      required
                    >
                      <SelectTrigger id="shop">
                        <SelectValue placeholder="Select a shop" />
                      </SelectTrigger>
                      <SelectContent>
                        {shops.map((shop) => (
                          <SelectItem key={shop.id} value={shop.id}>
                            {shop.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? 'Creating...' : 'Create Account'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="font-light">Merchant Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Loading merchants...</div>
            ) : merchants.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No merchant accounts yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-light">Name</TableHead>
                      <TableHead className="font-light">Email</TableHead>
                      <TableHead className="font-light">Shop</TableHead>
                      <TableHead className="font-light">Created</TableHead>
                      <TableHead className="font-light">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {merchants.map((merchant) => (
                      <TableRow key={merchant.id}>
                        <TableCell className="font-light">{merchant.name}</TableCell>
                        <TableCell className="font-light">{merchant.email}</TableCell>
                        <TableCell className="font-light">{merchant.shop_name}</TableCell>
                        <TableCell className="font-light">
                          {new Date(merchant.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResetPassword(merchant.email)}
                            className="text-primary hover:bg-orange-50"
                          >
                            <Mail className="w-4 h-4" />
                            Reset Password
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
