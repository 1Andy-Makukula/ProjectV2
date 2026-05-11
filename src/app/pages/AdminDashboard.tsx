// KithLy Admin Dashboard - Platform Management

import { useState } from 'react';
import { motion } from 'motion/react';
import { Users, Store, Gift, TrendingUp, AlertCircle, CheckCircle, Clock, Ban } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { mockUsers, mockProfiles, mockShops, mockProducts } from '../data/mock-data';
import { formatZMW } from '../utils/formatters';

export function AdminDashboard() {
  const [selectedTab, setSelectedTab] = useState('overview');

  // Mock stats
  const stats = {
    totalUsers: mockUsers.length,
    totalMerchants: mockShops.length,
    totalProducts: mockProducts.length,
    totalRevenue: 125000,
    pendingVerifications: mockProfiles.filter(p => !p.is_verified).length,
    activeGifts: 45,
  };

  const recentTransactions = [
    { id: '1', handshake: 'KL-8A9B2C', buyer: 'Mwape Banda', merchant: 'Shoprite Garden', amount: 250, status: 'completed' },
    { id: '2', handshake: 'KL-7D4E3F', buyer: 'Chanda Phiri', merchant: 'Manda Hill Cafe', amount: 180, status: 'pending' },
    { id: '3', handshake: 'KL-6G5H1J', buyer: 'Bwalya Mwansa', merchant: 'Kabwe Electronics', amount: 450, status: 'completed' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-light text-black mb-2">Admin Dashboard</h1>
          <p className="text-sm font-light text-muted-foreground">Manage KithLy marketplace platform</p>
        </div>

        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
            <TabsTrigger value="overview" className="font-light">Overview</TabsTrigger>
            <TabsTrigger value="users" className="font-light">Users</TabsTrigger>
            <TabsTrigger value="merchants" className="font-light">Merchants</TabsTrigger>
            <TabsTrigger value="transactions" className="font-light">Transactions</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <StatCard
                title="Total Users"
                value={stats.totalUsers}
                icon={Users}
                trend="+12%"
              />
              <StatCard
                title="Active Merchants"
                value={stats.totalMerchants}
                icon={Store}
                trend="+8%"
              />
              <StatCard
                title="Total Products"
                value={stats.totalProducts}
                icon={Gift}
                trend="+24%"
              />
              <StatCard
                title="Monthly Revenue"
                value={formatZMW(stats.totalRevenue)}
                icon={TrendingUp}
                trend="+15%"
              />
              <StatCard
                title="Pending Verifications"
                value={stats.pendingVerifications}
                icon={AlertCircle}
                alert
              />
              <StatCard
                title="Active Gifts"
                value={stats.activeGifts}
                icon={Gift}
                trend="+5%"
              />
            </div>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle className="font-light">Recent Transactions</CardTitle>
                <CardDescription className="font-light">Latest handshake redemptions</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-light">Handshake</TableHead>
                      <TableHead className="font-light">Buyer</TableHead>
                      <TableHead className="font-light">Merchant</TableHead>
                      <TableHead className="font-light">Amount</TableHead>
                      <TableHead className="font-light">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="font-mono font-light">{tx.handshake}</TableCell>
                        <TableCell className="font-light">{tx.buyer}</TableCell>
                        <TableCell className="font-light">{tx.merchant}</TableCell>
                        <TableCell className="font-light">{formatZMW(tx.amount)}</TableCell>
                        <TableCell>
                          <Badge variant={tx.status === 'completed' ? 'default' : 'secondary'} className="font-light">
                            {tx.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="font-light">User Management</CardTitle>
                <CardDescription className="font-light">Manage platform users</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-light">Name</TableHead>
                      <TableHead className="font-light">Email</TableHead>
                      <TableHead className="font-light">Role</TableHead>
                      <TableHead className="font-light">Verified</TableHead>
                      <TableHead className="font-light">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mockUsers.slice(0, 5).map((user) => {
                      const profile = mockProfiles.find(p => p.user_id === user.id);
                      return (
                        <TableRow key={user.id}>
                          <TableCell className="font-light">{profile?.full_name || 'N/A'}</TableCell>
                          <TableCell className="font-light">{user.email}</TableCell>
                          <TableCell>
                            <Badge className="font-light">{user.role}</Badge>
                          </TableCell>
                          <TableCell>
                            {profile?.is_verified ? (
                              <CheckCircle className="w-4 h-4 text-green-600" />
                            ) : (
                              <Clock className="w-4 h-4 text-orange-600" />
                            )}
                          </TableCell>
                          <TableCell>
                            <button className="text-sm font-light text-[#F97316] hover:underline">
                              View
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Merchants Tab */}
          <TabsContent value="merchants" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="font-light">Merchant Management</CardTitle>
                <CardDescription className="font-light">Manage merchant shops</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-light">Shop Name</TableHead>
                      <TableHead className="font-light">District</TableHead>
                      <TableHead className="font-light">Products</TableHead>
                      <TableHead className="font-light">Status</TableHead>
                      <TableHead className="font-light">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mockShops.slice(0, 5).map((shop) => {
                      const productCount = mockProducts.filter(p => p.shop_id === shop.id).length;
                      return (
                        <TableRow key={shop.id}>
                          <TableCell className="font-light">{shop.name}</TableCell>
                          <TableCell className="font-light">{shop.district?.name}</TableCell>
                          <TableCell className="font-light">{productCount}</TableCell>
                          <TableCell>
                            <Badge variant={shop.is_verified ? 'default' : 'secondary'} className="font-light">
                              {shop.is_verified ? 'Verified' : 'Pending'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <button className="text-sm font-light text-[#F97316] hover:underline">
                              Manage
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Transactions Tab */}
          <TabsContent value="transactions" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="font-light">Transaction History</CardTitle>
                <CardDescription className="font-light">All platform transactions</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-light">Date</TableHead>
                      <TableHead className="font-light">Handshake</TableHead>
                      <TableHead className="font-light">Amount</TableHead>
                      <TableHead className="font-light">Commission</TableHead>
                      <TableHead className="font-light">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="font-light">Apr 18, 2026</TableCell>
                        <TableCell className="font-mono font-light">{tx.handshake}</TableCell>
                        <TableCell className="font-light">{formatZMW(tx.amount)}</TableCell>
                        <TableCell className="font-light text-[#F97316]">{formatZMW(tx.amount * 0.05)}</TableCell>
                        <TableCell>
                          <Badge variant={tx.status === 'completed' ? 'default' : 'secondary'} className="font-light">
                            {tx.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({ title, value, icon: Icon, trend, alert }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <Card className={alert ? 'border-orange-200 bg-orange-50' : ''}>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 rounded-xl ${alert ? 'bg-orange-100' : 'bg-gray-100'} flex items-center justify-center`}>
              <Icon className={`w-6 h-6 ${alert ? 'text-[#F97316]' : 'text-black'}`} strokeWidth={1.5} />
            </div>
            {trend && !alert && (
              <span className="text-xs font-light text-green-600">{trend}</span>
            )}
          </div>
          <h3 className="text-sm font-light text-muted-foreground mb-1">{title}</h3>
          <p className="text-2xl font-medium text-black">{value}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
