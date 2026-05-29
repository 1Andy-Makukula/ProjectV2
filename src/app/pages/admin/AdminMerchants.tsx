import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  Plus, Key, Mail, Pencil, Trash2,
  User, Store, Shield, X, ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '../../components/ui/table';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '../../components/ui/select';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '../../components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '../../components/ui/alert-dialog';
import { Badge } from '../../components/ui/badge';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { supabase } from '../../../lib/supabaseClient';
import { callServer } from '../../../utils/server';
import { toast } from 'sonner';

interface Merchant {
  id: string;
  name: string;
  email: string;
  phone?: string;
  created_at: string;
  shop_id?: string;
  shop_name?: string;
}

interface Shop {
  id: string;
  name: string;
}

type EditTab = 'profile' | 'shop' | 'security';

export function AdminMerchants() {
  const navigate = useNavigate();

  // ── List state ──────────────────────────────────────────────────────────────
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Create dialog ────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '', shopId: '' });
  const [creating, setCreating] = useState(false);

  // ── Edit panel ───────────────────────────────────────────────────────────────
  const [editMerchant, setEditMerchant] = useState<Merchant | null>(null);
  const [editTab, setEditTab] = useState<EditTab>('profile');
  const [editProfile, setEditProfile] = useState({ name: '', phone: '' });
  const [editShopId, setEditShopId] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Init ─────────────────────────────────────────────────────────────────────
  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (createOpen) {
      setCreateForm({ name: '', email: '', password: generatePassword(), shopId: '' });
    }
  }, [createOpen]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const generatePassword = () => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    return Array.from({ length: 12 }, () => charset[Math.floor(Math.random() * charset.length)]).join('');
  };

  const loadData = async () => {
    try {
      setLoading(true);

      const { data: merchantsData, error: mErr } = await supabase
        .from('users')
        .select('*')
        .eq('role', 'merchant')
        .order('created_at', { ascending: false });
      if (mErr) throw mErr;

      const { data: shopsData, error: sErr } = await supabase
        .from('shops')
        .select('id, name')
        .order('name');
      if (sErr) throw sErr;
      setShops(shopsData || []);

      const enriched = await Promise.all(
        (merchantsData || []).map(async (m) => {
          const { data: assign } = await supabase
            .from('merchant_shops')
            .select('shop_id, shop:shops(name)')
            .eq('user_id', m.id)
            .maybeSingle();

          const shopName =
            (assign?.shop as any)?.name ??
            (Array.isArray(assign?.shop) ? (assign.shop as any)[0]?.name : undefined) ??
            null;

          return {
            id: m.id,
            name: m.name,
            email: m.email,
            phone: m.phone ?? '',
            created_at: m.created_at,
            shop_id: assign?.shop_id ?? undefined,
            shop_name: shopName,
          } as Merchant;
        })
      );

      setMerchants(enriched);
    } catch (err: any) {
      toast.error('Failed to load merchants');
    } finally {
      setLoading(false);
    }
  };

  // ── Create ───────────────────────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name || !createForm.email || !createForm.password || !createForm.shopId) {
      toast.error('Please fill in all fields');
      return;
    }
    setCreating(true);
    try {
      await callServer('/merchants', {
        body: {
          name: createForm.name,
          email: createForm.email,
          password: createForm.password,
          shopId: createForm.shopId,
        },
      });
      toast.success('Merchant account created');
      toast.info(`Temporary password: ${createForm.password}`, { duration: 10000 });
      setCreateOpen(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create merchant');
    } finally {
      setCreating(false);
    }
  };

  // ── Open edit panel ───────────────────────────────────────────────────────────
  const openEdit = (m: Merchant) => {
    setEditMerchant(m);
    setEditProfile({ name: m.name, phone: m.phone ?? '' });
    setEditShopId(m.shop_id ?? '');
    setEditPassword('');
    setEditTab('profile');
  };

  const closeEdit = () => setEditMerchant(null);

  // ── Save profile ─────────────────────────────────────────────────────────────
  const saveProfile = async () => {
    if (!editMerchant || !editProfile.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({ name: editProfile.name.trim(), phone: editProfile.phone.trim() || null })
        .eq('id', editMerchant.id);
      if (error) throw error;
      toast.success('Profile updated');
      loadData();
      closeEdit();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  // ── Save shop assignment ──────────────────────────────────────────────────────
  const saveShopAssignment = async () => {
    if (!editMerchant) return;
    setSaving(true);
    try {
      // Remove old assignment
      await supabase.from('merchant_shops').delete().eq('user_id', editMerchant.id);

      if (editShopId) {
        const { error } = await supabase
          .from('merchant_shops')
          .insert({ user_id: editMerchant.id, shop_id: editShopId });
        if (error) throw error;
      }

      toast.success('Shop assignment updated');
      loadData();
      closeEdit();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update shop assignment');
    } finally {
      setSaving(false);
    }
  };

  // ── Reset password ────────────────────────────────────────────────────────────
  const sendPasswordReset = async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      toast.success(`Password reset email sent to ${email}`);
    } catch (err: any) {
      toast.error('Failed to send reset email');
    }
  };

  const setNewPassword = async () => {
    if (!editMerchant || editPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setSaving(true);
    try {
      // Admin password reset via server function
      await callServer('/admin-reset-password', {
        body: { userId: editMerchant.id, newPassword: editPassword },
      });
      toast.success('Password updated');
      setEditPassword('');
      closeEdit();
    } catch (err: any) {
      // Fallback: send email reset instead
      await sendPasswordReset(editMerchant.email);
      toast.info('Direct reset unavailable — sent email reset instead');
      closeEdit();
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────
  const handleDelete = async (merchant: Merchant) => {
    try {
      // Remove shop assignment first
      await supabase.from('merchant_shops').delete().eq('user_id', merchant.id);
      // Downgrade role to sender (auth deletion requires Admin API)
      const { error } = await supabase
        .from('users')
        .update({ role: 'sender' })
        .eq('id', merchant.id);
      if (error) throw error;
      toast.success(`${merchant.name} removed as merchant`);
      loadData();
    } catch (err: any) {
      toast.error('Failed to remove merchant');
    }
  };

  // ── UI ────────────────────────────────────────────────────────────────────────
  const tabs: { id: EditTab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile',  label: 'Profile',  icon: <User className="w-4 h-4" /> },
    { id: 'shop',     label: 'Shop',     icon: <Store className="w-4 h-4" /> },
    { id: 'security', label: 'Security', icon: <Shield className="w-4 h-4" /> },
  ];

  return (
    <PageShell>
      <AdminPageHeader
        title="Manage Merchants"
        subtitle="Create, edit and remove merchant accounts"
        onBack={() => navigate('/admin')}
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-white text-primary hover:bg-white/90 h-8">
                <Plus className="size-3.5" />
                Create Merchant
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Create Merchant Account</DialogTitle>
                  <DialogDescription>
                    Set up credentials and assign a shop immediately.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  {/* Name */}
                  <div className="space-y-1.5">
                    <Label htmlFor="c-name">Full Name *</Label>
                    <Input id="c-name" value={createForm.name}
                      onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                      placeholder="Merchant name" required />
                  </div>

                  {/* Email */}
                  <div className="space-y-1.5">
                    <Label htmlFor="c-email">Email *</Label>
                    <Input id="c-email" type="email" value={createForm.email}
                      onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                      placeholder="merchant@example.com" required />
                  </div>

                  {/* Password */}
                  <div className="space-y-1.5">
                    <Label htmlFor="c-password">Temporary Password *</Label>
                    <div className="flex gap-2">
                      <Input id="c-password" type="text" value={createForm.password}
                        onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                        required />
                      <Button type="button" variant="outline"
                        onClick={() => setCreateForm({ ...createForm, password: generatePassword() })}>
                        <Key className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Share this with the merchant — they can change it after login.</p>
                  </div>

                  {/* Shop */}
                  <div className="space-y-1.5">
                    <Label htmlFor="c-shop">Assign to Shop *</Label>
                    <Select value={createForm.shopId}
                      onValueChange={v => setCreateForm({ ...createForm, shopId: v })}>
                      <SelectTrigger id="c-shop"><SelectValue placeholder="Select a shop" /></SelectTrigger>
                      <SelectContent>
                        {shops.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={creating}>
                    {creating ? 'Creating…' : 'Create Account'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {/* ── Merchant table ────────────────────────────────────────────────────── */}
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle className="font-light">
              Merchant Accounts
              {!loading && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({merchants.length})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-10 text-muted-foreground">Loading merchants…</div>
            ) : merchants.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">No merchant accounts yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Shop</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {merchants.map(m => (
                      <TableRow key={m.id} className="group">
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="font-light text-muted-foreground">{m.email}</TableCell>
                        <TableCell>
                          {m.shop_name ? (
                            <Badge variant="tint">{m.shop_name}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell className="font-light text-muted-foreground text-sm">
                          {new Date(m.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {/* Edit */}
                            <Button variant="ghost" size="sm"
                              onClick={() => openEdit(m)}
                              className="text-primary hover:bg-primary-tint h-7">
                              <Pencil className="size-3.5" />
                              Edit
                            </Button>

                            {/* Password reset */}
                            <Button variant="ghost" size="sm"
                              onClick={() => sendPasswordReset(m.email)}
                              className="text-slate-500 hover:bg-slate-50">
                              <Mail className="w-3.5 h-3.5" />
                            </Button>

                            {/* Delete */}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm"
                                  className="text-rose-500 hover:bg-rose-50">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove Merchant?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    <strong>{m.name}</strong> will lose merchant access and their shop
                                    assignment will be removed. Their account remains active as a sender.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(m)}
                                    className="bg-rose-500 hover:bg-rose-600">
                                    Remove Merchant
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>

      {/* ── Edit side-panel ───────────────────────────────────────────────────── */}
      {editMerchant && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/40 backdrop-blur-sm"
            onClick={closeEdit}
          />

          {/* Panel */}
          <div className="w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-y-auto">

            {/* Panel header */}
            <div className="bg-gradient-to-r from-primary to-primary/90 text-white px-6 py-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-light">Edit Merchant</h2>
                  <p className="text-sm opacity-80 font-light">{editMerchant.name}</p>
                </div>
                <Button variant="ghost" size="icon"
                  onClick={closeEdit}
                  className="text-white hover:bg-white/10">
                  <X className="w-5 h-5" />
                </Button>
              </div>

              {/* Tab bar */}
              <div className="flex gap-1 mt-4">
                {tabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setEditTab(t.id)}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-light transition-all ${
                      editTab === t.id
                        ? 'bg-white text-primary font-medium'
                        : 'text-white/80 hover:bg-white/10'
                    }`}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 p-6 space-y-6">

              {/* ── Profile tab ── */}
              {editTab === 'profile' && (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="e-name">Full Name *</Label>
                    <Input id="e-name" value={editProfile.name}
                      onChange={e => setEditProfile({ ...editProfile, name: e.target.value })}
                      placeholder="Merchant name" />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="e-email">Email</Label>
                    <Input id="e-email" value={editMerchant.email} disabled
                      className="bg-gray-50 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="e-phone">Phone</Label>
                    <Input id="e-phone" value={editProfile.phone}
                      onChange={e => setEditProfile({ ...editProfile, phone: e.target.value })}
                      placeholder="+260 XXX XXX XXX" />
                  </div>

                  <div className="pt-2 flex items-center gap-3">
                    <Button onClick={saveProfile} disabled={saving} className="flex-1">
                      {saving ? 'Saving…' : 'Save Profile'}
                    </Button>
                    <Button variant="outline" onClick={closeEdit}>Cancel</Button>
                  </div>
                </div>
              )}

              {/* ── Shop tab ── */}
              {editTab === 'shop' && (
                <div className="space-y-5">
                  <div className="rounded-lg border border-orange-100 bg-orange-50 p-4 text-sm text-orange-700">
                    Currently assigned: <strong>{editMerchant.shop_name ?? 'No shop'}</strong>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Reassign to Shop</Label>
                    <Select value={editShopId} onValueChange={setEditShopId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a shop" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">— Unassign —</SelectItem>
                        {shops.map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            <div className="flex items-center gap-2">
                              <Store className="w-3.5 h-3.5 text-muted-foreground" />
                              {s.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      The previous assignment will be replaced immediately.
                    </p>
                  </div>

                  <div className="pt-2 flex items-center gap-3">
                    <Button onClick={saveShopAssignment} disabled={saving} className="flex-1">
                      {saving ? 'Saving…' : 'Save Assignment'}
                    </Button>
                    <Button variant="outline" onClick={closeEdit}>Cancel</Button>
                  </div>
                </div>
              )}

              {/* ── Security tab ── */}
              {editTab === 'security' && (
                <div className="space-y-5">
                  {/* Email reset */}
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <Mail className="w-4 h-4 text-primary" />
                      Send Password Reset Email
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Sends a reset link to <strong>{editMerchant.email}</strong>.
                    </p>
                    <Button variant="outline" size="sm"
                      onClick={() => { sendPasswordReset(editMerchant.email); closeEdit(); }}>
                      <Mail className="w-3.5 h-3.5" />
                      Send Reset Email
                    </Button>
                  </div>

                  {/* Manual password */}
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <Key className="w-4 h-4 text-primary" />
                      Set New Password Directly
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={editPassword}
                        onChange={e => setEditPassword(e.target.value)}
                        placeholder="Min 8 characters"
                      />
                      <Button type="button" variant="outline"
                        onClick={() => setEditPassword(generatePassword())}>
                        <Key className="w-4 h-4" />
                      </Button>
                    </div>
                    <Button onClick={setNewPassword} disabled={saving || editPassword.length < 8}
                      size="sm">
                      {saving ? 'Saving…' : 'Set Password'}
                    </Button>
                  </div>

                  {/* Remove merchant access */}
                  <div className="rounded-lg border border-rose-100 p-4 space-y-3">
                    <div className="flex items-center gap-2 font-medium text-sm text-rose-600">
                      <Trash2 className="w-4 h-4" />
                      Remove Merchant Access
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Downgrades the account to a sender. Shop assignment is removed. Account is not deleted.
                    </p>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm">Remove Access</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove Merchant Access?</AlertDialogTitle>
                          <AlertDialogDescription>
                            <strong>{editMerchant.name}</strong> will be downgraded to a sender.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => { handleDelete(editMerchant); closeEdit(); }}
                            className="bg-rose-500 hover:bg-rose-600">
                            Confirm
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              )}
            </div>

            {/* Panel footer breadcrumb */}
            <div className="border-t px-6 py-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Merchants</span>
              <ChevronRight className="w-3 h-3" />
              <span className="text-foreground font-medium">{editMerchant.name}</span>
              <ChevronRight className="w-3 h-3" />
              <span className="capitalize">{editTab}</span>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
