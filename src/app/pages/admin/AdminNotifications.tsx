// AdminNotifications — Broadcast an announcement to a set of users at '/admin/notifications'

import { useNavigate } from 'react-router';
import { Megaphone } from 'lucide-react';
import { PageShell, PageBody } from '../../components/layout/PageShell';
import { AdminPageHeader } from '../../components/layout/AdminPageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { useAdminBroadcast, type BroadcastAudience } from '../../hooks/useAdminBroadcast';

const AUDIENCE_LABELS: Record<BroadcastAudience, string> = {
  all: 'All Users',
  sender: 'Senders (Gift Buyers)',
  merchant: 'Merchants',
};

const TYPE_LABELS: Record<string, string> = {
  announcement: 'Announcement',
  promo: 'Promo',
  reminder: 'Alert',
};

export function AdminNotifications() {
  const navigate = useNavigate();
  const { message, setMessage, type, setType, audience, setAudience, sending, sendBroadcast } = useAdminBroadcast();

  const handleSend = async () => {
    const audienceLabel = AUDIENCE_LABELS[audience];
    if (!confirm(`Send this notification to ${audienceLabel}? This cannot be undone.`)) return;
    await sendBroadcast();
  };

  return (
    <PageShell>
      <AdminPageHeader
        title="Notifications"
        subtitle="Broadcast an announcement to users"
        onBack={() => navigate('/admin')}
      />
      <PageBody className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              Compose Broadcast
            </CardTitle>
            <CardDescription>
              This creates a notification row for every matching user — they'll see it in their
              notification bell in realtime.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="broadcast-message">Message</Label>
              <Textarea
                id="broadcast-message"
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="e.g. New Weekly Picks are live — check out this week's featured shops!"
                rows={4}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Audience</Label>
                <Select value={audience} onValueChange={v => setAudience(v as BroadcastAudience)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(AUDIENCE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button onClick={handleSend} disabled={sending || !message.trim()} className="w-full">
              {sending ? 'Sending…' : `Send to ${AUDIENCE_LABELS[audience]}`}
            </Button>
          </CardContent>
        </Card>
      </PageBody>
    </PageShell>
  );
}

export default AdminNotifications;
