import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Connection, ConnectionType } from '../types';
import { Activity, HardDrive, ShieldCheck, UploadCloud, RefreshCw } from 'lucide-react';

interface DashboardProps {
  connections: Connection[];
}

interface QuotaData {
  [connectionId: string]: {
    used: number | null;
    total: number | null;
    loading: boolean;
  };
}

const isCloudProvider = (type?: ConnectionType) => {
  return type === ConnectionType.GDRIVE || type === ConnectionType.DROPBOX || type === ConnectionType.ONEDRIVE;
};

const Dashboard: React.FC<DashboardProps> = ({ connections }) => {
  const [quotaData, setQuotaData] = useState<QuotaData>({});
  const [refreshing, setRefreshing] = useState(false);

  // Fetch quota for a single connection
  const fetchQuota = async (conn: Connection) => {
    const token = localStorage.getItem('nexus_token');
    if (!token) return;

    setQuotaData(prev => ({
      ...prev,
      [conn.id]: { ...prev[conn.id], loading: true }
    }));

    try {
      let response;

      if (isCloudProvider(conn.type) && conn.accountName) {
        response = await fetch(`/api/rclone/quota/${encodeURIComponent(conn.accountName)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } else if (conn.type === ConnectionType.SFTP && conn.host) {
        response = await fetch('/api/fs/sftp/quota', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            host: conn.host,
            port: conn.port,
            connectionId: conn.id,
            path: conn.defaultPath || '/'
          })
        });
      } else {
        return;
      }

      if (response.ok) {
        const data = await response.json();
        setQuotaData(prev => ({
          ...prev,
          [conn.id]: { used: data.used, total: data.total, loading: false }
        }));
      }
    } catch (error) {
      console.error(`Error fetching quota for ${conn.name}:`, error);
      setQuotaData(prev => ({
        ...prev,
        [conn.id]: { used: null, total: null, loading: false }
      }));
    }
  };

  // Fetch all quotas on mount and when connections change
  const fetchAllQuotas = async () => {
    setRefreshing(true);
    const connectedConns = connections.filter(c => c.status === 'connected');
    await Promise.all(connectedConns.map(fetchQuota));
    setRefreshing(false);
  };

  useEffect(() => {
    if (connections.length > 0) {
      fetchAllQuotas();
    }
  }, [connections.length]);

  // Calculate stats from quota data
  const connectedCount = connections.filter(c => c.status === 'connected').length;
  const totalConnections = connections.length;

  const totalStorageUsed = Object.values(quotaData).reduce((sum, q) => sum + (q.used || 0), 0);
  const totalStorageLimit = Object.values(quotaData).reduce((sum, q) => sum + (q.total || 0), 0);

  const healthPercentage = totalConnections > 0
    ? Math.round((connectedCount / totalConnections) * 100)
    : 0;

  // Data for chart
  const data = connections.map(c => ({
    name: c.name.length > 10 ? c.name.substring(0, 10) + '...' : c.name,
    used: quotaData[c.id]?.used || 0,
    total: quotaData[c.id]?.total || 0,
  })).filter(d => d.total > 0);

  // Format storage display
  const formatStorage = (gb: number | null) => {
    if (gb === null || gb === 0) return '—';
    if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
    return `${gb.toFixed(1)} GB`;
  };

  const stats = [
    { title: 'Conexões Ativas', value: `${connectedCount}/${totalConnections}`, icon: Activity, color: 'text-blue-400' },
    { title: 'Armazenamento Usado', value: formatStorage(totalStorageUsed), icon: HardDrive, color: 'text-purple-400' },
    { title: 'Saúde das Conexões', value: `${healthPercentage}%`, icon: ShieldCheck, color: healthPercentage >= 80 ? 'text-green-400' : healthPercentage >= 50 ? 'text-yellow-400' : 'text-red-400' },
    { title: 'Capacidade Total', value: formatStorage(totalStorageLimit), icon: UploadCloud, color: 'text-orange-400' },
  ];

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Visão Geral</h2>
        <button
          onClick={fetchAllQuotas}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 bg-slate-800 rounded-lg ${stat.color}`}>
                <stat.icon size={24} />
              </div>
              <span className="text-xs font-medium bg-slate-800 text-slate-400 px-2 py-1 rounded">Atual</span>
            </div>
            <h3 className="text-3xl font-bold text-white">{stat.value}</h3>
            <p className="text-sm text-slate-500 mt-1">{stat.title}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-6">Uso de Armazenamento (GB)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                  cursor={{ fill: '#334155', opacity: 0.4 }}
                />
                <Bar dataKey="used" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#3b82f6' : '#8b5cf6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-4">Conexões Recentes</h3>
          <div className="space-y-4">
            {connections.map(c => (
              <div key={c.id} className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-800">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${c.status === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div>
                    <p className="text-sm font-medium text-white">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.type}</p>
                  </div>
                </div>
                <span className="text-xs text-slate-400">{c.lastSync}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;