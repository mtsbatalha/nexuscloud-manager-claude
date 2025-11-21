
import React, { useState, useEffect } from 'react';
import { Cloud, Server, Plus, Settings, Trash2, Save, X, CheckCircle, AlertCircle, Loader2, Shield, ExternalLink, Clock, HardDrive, FolderOpen, LogOut, User, Unplug, RefreshCw } from 'lucide-react';
import { Connection, ConnectionType } from '../types';

interface ConnectionManagerProps {
  connections: Connection[];
  onUpdateConnections: (connections: Connection[]) => void;
}

const ConnectionManager: React.FC<ConnectionManagerProps> = ({ connections, onUpdateConnections }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [testLatency, setTestLatency] = useState<number | undefined>(undefined);
  const [isOAuthLoading, setIsOAuthLoading] = useState(false);
  const [showReconnectDialog, setShowReconnectDialog] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState<Connection | null>(null);
  const [rcloneAuthMessage, setRcloneAuthMessage] = useState('');
  const [isRcloneAuthorizing, setIsRcloneAuthorizing] = useState(false);

  // Form State
  const [formData, setFormData] = useState<Partial<Connection>>({
    name: '',
    type: ConnectionType.SFTP,
    host: '',
    status: 'disconnected',
    accountName: ''
  });

  // Local state for credentials and extra fields
  const [tempUsername, setTempUsername] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [tempPort, setTempPort] = useState<number | undefined>(undefined);
  const [tempSecure, setTempSecure] = useState(false); // FTPS
  const [tempDomain, setTempDomain] = useState(''); // SMB
  const [tempMountOptions, setTempMountOptions] = useState(''); // NFS
  const [tempDefaultPath, setTempDefaultPath] = useState(''); // Default remote path

  const isCloudProvider = (type?: ConnectionType) => {
    return type === ConnectionType.GDRIVE || 
           type === ConnectionType.DROPBOX || 
           type === ConnectionType.ONEDRIVE;
  };

  const isLocal = (type?: ConnectionType) => {
    return type === ConnectionType.LOCAL;
  };

  // Auto-set host for cloud providers
  useEffect(() => {
    if (formData.type === ConnectionType.GDRIVE) {
      setFormData(prev => ({ ...prev, host: 'googleapis.com/drive/v3' }));
    } else if (formData.type === ConnectionType.DROPBOX) {
      setFormData(prev => ({ ...prev, host: 'api.dropboxapi.com' }));
    } else if (formData.type === ConnectionType.ONEDRIVE) {
      setFormData(prev => ({ ...prev, host: 'graph.microsoft.com' }));
    } else if (isCloudProvider(formData.type)) {
       // Generic fallback
       setFormData(prev => ({ ...prev, host: 'cloud-api-endpoint' }));
    } else if (formData.type === ConnectionType.LOCAL && !formData.host) {
       setFormData(prev => ({ ...prev, host: '' })); // Clear for user input
    }
  }, [formData.type]);

  const handleOpenModal = async (conn?: Connection) => {
    if (conn) {
      setEditingId(conn.id);
      setFormData({ ...conn });
      setTestStatus(conn.status === 'connected' ? 'success' : 'idle');
      setTestMessage('');
      setTestLatency(undefined);
      setTempPort(conn.port);
      setTempSecure(conn.secure || false);
      setTempDomain(conn.domain || '');
      setTempMountOptions(conn.mountOptions || '');
      setTempDefaultPath(conn.defaultPath || '');

      // Load stored credentials from backend
      try {
        const token = localStorage.getItem('nexus_token');
        const response = await fetch(`/api/credentials/${conn.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setTempUsername(data.username || '');
          setTempPassword(data.password || '');
          if (data.port) setTempPort(data.port);
          if (data.secure !== undefined) setTempSecure(data.secure);
        } else {
          setTempUsername('');
          setTempPassword('');
        }
      } catch (e) {
        console.error('Error loading credentials:', e);
        setTempUsername('');
        setTempPassword('');
      }
    } else {
      setEditingId(null);
      setFormData({
        name: '',
        type: ConnectionType.SFTP,
        host: '',
        status: 'disconnected',
        storageUsed: 0,
        storageLimit: 100,
        accountName: ''
      });
      setTempUsername('');
      setTempPassword('');
      setTempPort(undefined);
      setTempSecure(false);
      setTempDomain('');
      setTempMountOptions('');
      setTempDefaultPath('');
      setTestStatus('idle');
      setTestMessage('');
      setTestLatency(undefined);
    }
    setRcloneAuthMessage('');
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.type) return;

    // Determine final status based on test or oauth
    const finalStatus: 'connected' | 'disconnected' | 'error' = testStatus === 'success' ? 'connected' : 'disconnected';

    const connectionData = {
      ...formData,
      port: tempPort,
      secure: tempSecure,
      domain: tempDomain,
      mountOptions: tempMountOptions,
      defaultPath: tempDefaultPath || undefined,
    } as Connection;

    let connectionId = editingId;

    if (editingId) {
      // Update existing
      const updated = connections.map(c => c.id === editingId ? { ...c, ...connectionData, status: finalStatus } : c);
      onUpdateConnections(updated);
    } else {
      // Create new
      connectionId = Date.now().toString();
      const newConn: Connection = {
        ...connectionData,
        id: connectionId,
        status: finalStatus,
        lastSync: 'Nunca',
        storageUsed: 0,
        storageLimit: 1000 // Default 1TB
      };
      onUpdateConnections([...connections, newConn]);
    }

    // Save credentials securely to backend (for SFTP, FTP, S3, SMB, NFS)
    if (connectionId && tempUsername && tempPassword && !isCloudProvider(formData.type) && !isLocal(formData.type)) {
      try {
        const token = localStorage.getItem('nexus_token');
        await fetch(`/api/credentials/${connectionId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            username: tempUsername,
            password: tempPassword,
            port: tempPort,
            secure: tempSecure
          })
        });
      } catch (e) {
        console.error('Error saving credentials:', e);
      }
    }

    // Create rclone remote for cloud providers
    if (isCloudProvider(formData.type) && formData.name) {
      try {
        const token = localStorage.getItem('nexus_token');
        const remoteName = formData.name.replace(/[^a-zA-Z0-9_]/g, '_');

        // Map connection type to rclone type
        const typeMap: Record<string, string> = {
          'Google Drive': 'drive',
          'Dropbox': 'dropbox',
          'OneDrive': 'onedrive'
        };
        const rcloneType = typeMap[formData.type] || 'drive';

        // Create rclone remote
        await fetch('/api/rclone/remotes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            name: remoteName,
            type: rcloneType,
            parameters: {}
          })
        });

        console.log(`Rclone remote "${remoteName}" created for ${formData.type}`);
      } catch (e) {
        console.error('Error creating rclone remote:', e);
        // Don't block save if rclone creation fails
      }
    }

    // Show reconnect dialog if editing and not already connected
    if (editingId && testStatus !== 'success' && !isCloudProvider(formData.type) && !isLocal(formData.type)) {
      setPendingSaveData(connectionData);
      setShowReconnectDialog(true);
    } else {
      setIsModalOpen(false);
    }
  };

  const handleDelete = async () => {
    if (editingId) {
      const connToDelete = connections.find(c => c.id === editingId);

      // Delete credentials from backend
      try {
        const token = localStorage.getItem('nexus_token');
        await fetch(`/api/credentials/${editingId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      } catch (e) {
        console.error('Error deleting credentials:', e);
      }

      // Delete rclone remote for cloud providers
      if (connToDelete && isCloudProvider(connToDelete.type)) {
        try {
          const token = localStorage.getItem('nexus_token');
          const remoteName = connToDelete.name.replace(/[^a-zA-Z0-9_]/g, '_');
          await fetch(`/api/rclone/remotes/${remoteName}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          console.log(`Rclone remote "${remoteName}" deleted`);
        } catch (e) {
          console.error('Error deleting rclone remote:', e);
        }
      }

      onUpdateConnections(connections.filter(c => c.id !== editingId));
      setIsModalOpen(false);
    }
  };

  // Disconnect a remote server
  const handleDisconnectServer = () => {
    if (editingId) {
      const updated = connections.map(c =>
        c.id === editingId ? { ...c, status: 'disconnected' as const } : c
      );
      onUpdateConnections(updated);
      setTestStatus('idle');
      setTestMessage('Servidor desconectado.');
      setFormData(prev => ({ ...prev, status: 'disconnected' }));
    }
  };

  // Handle reconnect confirmation
  const handleReconnectConfirm = async () => {
    setShowReconnectDialog(false);
    if (pendingSaveData) {
      // Trigger connection test with new data
      await handleTestConnection();
      setPendingSaveData(null);
    }
  };

  const handleReconnectSkip = () => {
    setShowReconnectDialog(false);
    setPendingSaveData(null);
    setIsModalOpen(false);
  };

  const handleTestConnection = async () => {
    if (!formData.host) {
      setTestStatus('error');
      setTestMessage(isLocal(formData.type) ? 'O caminho do diretório é obrigatório.' : 'O campo Host é obrigatório para o teste.');
      return;
    }

    // Only check credentials if not local and not cloud
    if (!isLocal(formData.type) && !isCloudProvider(formData.type)) {
      if (!tempUsername || !tempPassword) {
        setTestStatus('error');
        setTestMessage('Usuário e Senha são necessários.');
        return;
      }
    }

    setIsTesting(true);
    setTestStatus('idle');
    setTestMessage('');
    setTestLatency(undefined);

    try {
      // Get token from localStorage
      const token = localStorage.getItem('nexus_token');
      if (!token) {
        setIsTesting(false);
        setTestStatus('error');
        setTestMessage('Sessão expirada. Faça login novamente.');
        return;
      }

      const response = await fetch('/api/connections/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          type: formData.type,
          host: formData.host,
          port: tempPort,
          secure: tempSecure,
          username: tempUsername,
          password: tempPassword,
          domain: tempDomain,
          mountOptions: tempMountOptions
        })
      });

      const result = await response.json();

      setIsTesting(false);

      if (!response.ok) {
        setTestStatus('error');
        setTestMessage(result.error || 'Erro ao testar conexão');
        return;
      }

      setTestStatus(result.success ? 'success' : 'error');
      setTestMessage(result.message);
      if (result.latency) setTestLatency(result.latency);

    } catch (e: any) {
      setIsTesting(false);
      setTestStatus('error');
      setTestMessage(e.message || 'Erro de rede desconhecido.');
    }
  };

  const handleOAuthLogin = async () => {
    setIsOAuthLoading(true);
    setTestStatus('idle');
    setTestMessage('Inicializando autenticação OAuth...');

    try {
      // Map connection type to provider name
      const providerMap: Record<string, string> = {
        'Google Drive': 'google',
        'Dropbox': 'dropbox',
        'OneDrive': 'onedrive'
      };

      const provider = providerMap[formData.type as string];
      if (!provider) {
        throw new Error('Provedor OAuth não suportado');
      }

      // Get authorization URL from backend
      const response = await fetch(`/api/oauth/authorize/${provider}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao iniciar OAuth');
      }

      setTestMessage('Aguardando autorização do usuário...');

      // Open popup for OAuth
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        data.authUrl,
        'oauth_popup',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
      );

      if (!popup) {
        throw new Error('Popup bloqueado. Permita popups para este site.');
      }

      // Listen for message from popup
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'oauth_success') {
          window.removeEventListener('message', handleMessage);
          setIsOAuthLoading(false);
          setTestStatus('success');
          setTestMessage('Autenticado com sucesso via OAuth 2.0');
          setFormData(prev => ({
            ...prev,
            status: 'connected',
            accountName: event.data.email || event.data.name || 'Conta conectada'
          }));
        } else if (event.data.type === 'oauth_error') {
          window.removeEventListener('message', handleMessage);
          setIsOAuthLoading(false);
          setTestStatus('error');
          setTestMessage(event.data.error || 'Falha na autenticação OAuth');
        }
      };

      window.addEventListener('message', handleMessage);

      // Check if popup was closed without completing
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          if (testStatus === 'idle') {
            setIsOAuthLoading(false);
            setTestStatus('error');
            setTestMessage('Autenticação cancelada pelo usuário');
          }
        }
      }, 500);

    } catch (error: any) {
      setIsOAuthLoading(false);
      setTestStatus('error');
      setTestMessage(error.message || 'Falha na autenticação OAuth. Tente novamente.');
    }
  };

  const handleDisconnect = () => {
    setTestStatus('idle');
    setTestMessage('');
    setRcloneAuthMessage('');
    setFormData(prev => ({ ...prev, status: 'disconnected', accountName: '' }));
  };

  // Handle Rclone authorization for cloud providers
  const handleRcloneAuthorize = async () => {
    if (!formData.name) {
      setRcloneAuthMessage('Preencha o nome da conexão primeiro');
      return;
    }

    setIsRcloneAuthorizing(true);
    setRcloneAuthMessage('Criando remote...');

    try {
      const token = localStorage.getItem('nexus_token');
      const remoteName = formData.name.replace(/[^a-zA-Z0-9_]/g, '_');

      // Step 1: Create the remote
      const createResponse = await fetch('/api/rclone/authorize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          type: formData.type,
          name: remoteName
        })
      });

      const createData = await createResponse.json();

      if (!createResponse.ok) {
        setRcloneAuthMessage(`Erro: ${createData.error || 'Falha ao criar remote'}`);
        setIsRcloneAuthorizing(false);
        return;
      }

      // Step 2: If needs auth, open browser for authorization
      if (createData.needsAuth) {
        setRcloneAuthMessage('Abrindo navegador para autorização...\nComplete a autenticação na janela que abriu.');

        const authResponse = await fetch('/api/rclone/authorize-browser', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            remoteName: remoteName,
            remoteType: formData.type
          })
        });

        const authData = await authResponse.json();

        console.log('authResponse.ok:', authResponse.ok, 'authData:', authData);
        if (authResponse.ok) {
          if (authData.windowOpened) {
            console.log('Setting testStatus to success');
            setRcloneAuthMessage('Terminal aberto!\n\n1. Complete a autorização no navegador\n2. Aguarde a confirmação no terminal\n3. Feche o terminal e clique em Salvar');
            // Habilitar o botão Salvar após abrir o terminal
            setTestStatus('success');
            setFormData(prev => ({ ...prev, status: 'connected', accountName: remoteName }));
          } else {
            setRcloneAuthMessage('Autorização concluída com sucesso!');
            setTestStatus('success');
            setFormData(prev => ({ ...prev, status: 'connected', accountName: remoteName }));
          }
        } else {
          console.log('authResponse not ok');
          setRcloneAuthMessage(`Erro na autorização: ${authData.error || 'Falha'}\n\nVocê pode tentar manualmente:\nrclone config reconnect ${remoteName}:`);
        }
      } else {
        setRcloneAuthMessage(createData.message || 'Remote criado com sucesso');
        setTestStatus('success');
        setFormData(prev => ({ ...prev, status: 'connected', accountName: remoteName }));
      }
    } catch (error: any) {
      setRcloneAuthMessage(`Erro: ${error.message || 'Falha na comunicação com o servidor'}`);
    } finally {
      setIsRcloneAuthorizing(false);
    }
  };

  const getTypeIcon = (type: ConnectionType) => {
    switch (type) {
      case ConnectionType.S3:
      case ConnectionType.GDRIVE:
      case ConnectionType.DROPBOX:
      case ConnectionType.ONEDRIVE:
        return <Cloud size={20} className="text-blue-400" />;
      case ConnectionType.SMB:
      case ConnectionType.NFS:
        return <HardDrive size={20} className="text-orange-400" />;
      case ConnectionType.LOCAL:
        return <FolderOpen size={20} className="text-yellow-400" />;
      default:
        return <Server size={20} className="text-purple-400" />;
    }
  };

  const getProviderColor = (type?: ConnectionType) => {
    switch(type) {
      case ConnectionType.GDRIVE: return 'bg-green-600 hover:bg-green-500 shadow-green-900/20';
      case ConnectionType.DROPBOX: return 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/20';
      case ConnectionType.ONEDRIVE: return 'bg-cyan-700 hover:bg-cyan-600 shadow-cyan-900/20';
      default: return 'bg-primary-600 hover:bg-primary-500';
    }
  };

  const getProviderName = (type?: ConnectionType) => {
     switch(type) {
      case ConnectionType.GDRIVE: return 'Google Drive';
      case ConnectionType.DROPBOX: return 'Dropbox';
      case ConnectionType.ONEDRIVE: return 'Microsoft OneDrive';
      default: return 'Serviço';
    }
  };

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Cloud className="text-primary-500" />
            Gerenciar Conexões
          </h2>
          <p className="text-slate-400 mt-2">Adicione e configure acesso aos seus servidores e nuvens.</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-lg shadow-primary-900/20"
        >
          <Plus size={18} />
          Nova Conexão
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {connections.map(conn => (
          <div key={conn.id} className="bg-slate-900 p-6 rounded-xl border border-slate-800 hover:border-slate-600 transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
               <button onClick={() => handleOpenModal(conn)} className="text-slate-400 hover:text-white bg-slate-800 p-2 rounded-lg border border-slate-700">
                 <Settings size={16} />
               </button>
            </div>

            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-slate-800 rounded-lg">
                   {getTypeIcon(conn.type)}
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white truncate max-w-[150px]">{conn.name}</h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400 border border-slate-700">{conn.type}</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-3 text-sm text-slate-400 mb-6 bg-slate-950/50 p-4 rounded-lg">
              <div className="flex justify-between">
                <span>Status:</span>
                <span className={`flex items-center gap-1.5 ${conn.status === 'connected' ? 'text-green-400' : 'text-red-400'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${conn.status === 'connected' ? 'bg-green-400' : 'bg-red-400'}`} />
                  {conn.status === 'connected' ? 'Conectado' : 'Erro/Offline'}
                </span>
              </div>
              {isCloudProvider(conn.type) ? (
                 <div className="flex justify-between">
                  <span>Conta:</span>
                  <span className="text-slate-300 truncate max-w-[120px]" title={conn.accountName}>{conn.accountName || 'N/A'}</span>
                 </div>
              ) : (
                <div className="flex justify-between">
                  <span>{isLocal(conn.type) ? 'Caminho' : 'Host'}:</span>
                  <span className="text-slate-300 truncate max-w-[120px]">{conn.host || 'N/A'}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Última Sync:</span>
                <span className="text-slate-300">{conn.lastSync}</span>
              </div>
            </div>

            <div className="w-full bg-slate-800 rounded-full h-1.5 mb-2">
               <div 
                 className="bg-gradient-to-r from-blue-500 to-purple-500 h-1.5 rounded-full transition-all duration-1000" 
                 style={{ width: `${(conn.storageUsed && conn.storageLimit) ? (conn.storageUsed / conn.storageLimit) * 100 : 0}%` }}
               ></div>
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>{conn.storageUsed} GB usados</span>
              <span>{conn.storageLimit} GB total</span>
            </div>
            
            <button 
              onClick={() => handleOpenModal(conn)}
              className="mt-6 w-full py-2 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-sm font-medium"
            >
              Configurar
            </button>
          </div>
        ))}

        <button 
          onClick={() => handleOpenModal()}
          className="border-2 border-dashed border-slate-800 hover:border-primary-500/50 hover:bg-slate-900/50 rounded-xl flex flex-col items-center justify-center gap-3 text-slate-500 hover:text-primary-400 transition-all min-h-[280px]"
        >
          <div className="p-4 bg-slate-800 rounded-full group-hover:scale-110 transition-transform">
             <Plus size={24} />
          </div>
          <span className="font-medium">Adicionar Nova Conexão</span>
        </button>
      </div>

      {/* Config Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 w-full max-w-2xl rounded-2xl border border-slate-700 shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900 rounded-t-2xl">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Settings className="text-slate-400" size={20} />
                {editingId ? 'Configurar Conexão' : 'Nova Conexão'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="p-8 overflow-y-auto custom-scrollbar space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-400 mb-2">Nome da Conexão <span className="text-red-400">*</span></label>
                  <input 
                    type="text" 
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    placeholder={isCloudProvider(formData.type) ? "Ex: Google Drive Pessoal" : "Ex: Servidor Linux Principal"}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Tipo de Provedor</label>
                  <select 
                    value={formData.type}
                    onChange={(e) => setFormData({...formData, type: e.target.value as ConnectionType})}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white outline-none"
                  >
                    {Object.values(ConnectionType).map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                {/* Conditional Host/Path Field (Hidden for Cloud Providers) */}
                <div className={isCloudProvider(formData.type) ? 'opacity-50 pointer-events-none' : ''}>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    {isLocal(formData.type) ? 'Caminho do Diretório (Path)' : 'Host / Endpoint'} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.host || ''}
                    onChange={(e) => setFormData({...formData, host: e.target.value})}
                    disabled={isCloudProvider(formData.type)}
                    placeholder={
                      formData.type === ConnectionType.NFS ? "192.168.1.100:/var/nfs" :
                      isLocal(formData.type) ? (navigator.platform.includes('Win') ? "C:\\Usuarios\\Nome\\Docs" : "/home/user/docs") :
                      "ftp.exemplo.com"
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
                  />
                </div>

                {/* Port Field for SFTP, FTP, S3, SMB */}
                {(formData.type === ConnectionType.SFTP ||
                  formData.type === ConnectionType.FTP ||
                  formData.type === ConnectionType.S3 ||
                  formData.type === ConnectionType.SMB) && (
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                      Porta
                      <span className="text-xs text-slate-500 ml-2">
                        (Padrão: {formData.type === ConnectionType.SFTP ? '22' :
                                  formData.type === ConnectionType.FTP ? (tempSecure ? '990' : '21') :
                                  formData.type === ConnectionType.SMB ? '445' : '443'})
                      </span>
                    </label>
                    <input
                      type="number"
                      value={tempPort || ''}
                      onChange={(e) => setTempPort(e.target.value ? parseInt(e.target.value) : undefined)}
                      placeholder={
                        formData.type === ConnectionType.SFTP ? '22' :
                        formData.type === ConnectionType.FTP ? (tempSecure ? '990' : '21') :
                        formData.type === ConnectionType.SMB ? '445' : '443'
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
                    />
                  </div>
                )}

                {/* FTPS Toggle for FTP */}
                {formData.type === ConnectionType.FTP && (
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="ftps-toggle"
                      checked={tempSecure}
                      onChange={(e) => setTempSecure(e.target.checked)}
                      className="w-4 h-4 text-primary-600 bg-slate-950 border-slate-700 rounded focus:ring-primary-500"
                    />
                    <label htmlFor="ftps-toggle" className="text-sm text-slate-400">
                      Usar FTPS (FTP sobre TLS/SSL)
                    </label>
                  </div>
                )}

                {/* Default Remote Path for remote servers */}
                {(formData.type === ConnectionType.SFTP ||
                  formData.type === ConnectionType.FTP ||
                  formData.type === ConnectionType.S3 ||
                  formData.type === ConnectionType.SMB ||
                  formData.type === ConnectionType.NFS) && (
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                      Caminho Remoto Padrão
                      <span className="text-xs text-slate-500 ml-2">(Opcional)</span>
                    </label>
                    <input
                      type="text"
                      value={tempDefaultPath}
                      onChange={(e) => setTempDefaultPath(e.target.value)}
                      placeholder={
                        formData.type === ConnectionType.S3 ? "/bucket/prefix" :
                        formData.type === ConnectionType.SMB ? "/share/folder" :
                        "/var/data"
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Diretório que será aberto automaticamente ao explorar arquivos
                    </p>
                  </div>
                )}
              </div>

              {/* Conditional Auth Section */}
              {isCloudProvider(formData.type) ? (
                <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 flex flex-col items-center justify-center text-center min-h-[220px]">
                  
                  {isOAuthLoading ? (
                    <div className="flex flex-col items-center gap-4 py-4 w-full">
                       <div className="relative">
                         <div className="absolute inset-0 bg-primary-500/30 blur-xl rounded-full animate-pulse"></div>
                         <Loader2 className="animate-spin text-primary-400 relative z-10" size={48} />
                       </div>
                       <div className="space-y-1">
                         <p className="text-white font-medium animate-pulse">{testMessage}</p>
                         <p className="text-xs text-slate-500">Não feche esta janela</p>
                       </div>
                       <div className="w-64 bg-slate-800 rounded-full h-1 mt-2 overflow-hidden">
                          <div className="h-full bg-primary-500 animate-progress-indeterminate"></div>
                       </div>
                    </div>
                  ) : testStatus === 'success' ? (
                    <div className="w-full bg-slate-900 rounded-xl border border-slate-700 p-6 animate-in fade-in slide-in-from-bottom-4">
                       <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center gap-4">
                             <div className="h-14 w-14 rounded-full bg-gradient-to-br from-green-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-green-900/30">
                                <User className="text-white" size={24} />
                             </div>
                             <div className="text-left">
                                <h4 className="font-bold text-white text-lg">Conta Conectada</h4>
                                <p className="text-sm text-slate-400">{formData.accountName}</p>
                                <div className="flex items-center gap-1 mt-1 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full w-fit">
                                   <CheckCircle size={10} />
                                   <span>Token Válido</span>
                                </div>
                             </div>
                          </div>
                          <div className="p-2 bg-slate-800 rounded-lg border border-slate-700">
                             {getTypeIcon(formData.type as ConnectionType)}
                          </div>
                       </div>
                       
                       <button 
                         onClick={handleDisconnect}
                         className="w-full py-2.5 bg-slate-800 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 border border-slate-700 rounded-lg text-slate-400 transition-all text-sm font-medium flex items-center justify-center gap-2"
                       >
                         <LogOut size={16} /> Desconectar Conta
                       </button>
                    </div>
                  ) : (
                    <>
                      <div className="mb-6 p-4 bg-slate-900 rounded-full border border-slate-800 shadow-lg">
                         <Cloud size={40} className="text-slate-400" />
                      </div>
                      <h4 className="text-white font-medium mb-2 text-lg">Autenticação Segura</h4>
                      <p className="text-sm text-slate-400 mb-8 max-w-sm leading-relaxed">
                        O NexusCloud usará o protocolo OAuth 2.0 para se conectar ao 
                        <strong className="text-slate-200"> {getProviderName(formData.type)}</strong>. 
                        Nenhuma senha será armazenada nos nossos servidores.
                      </p>

                      <button
                        onClick={handleOAuthLogin}
                        className={`w-full max-w-xs px-6 py-3.5 rounded-xl font-bold text-white flex items-center justify-center gap-3 shadow-lg transition-all transform hover:scale-105 hover:shadow-xl ${getProviderColor(formData.type)}`}
                      >
                        <ExternalLink size={20} />
                        <span>Autenticar Agora</span>
                      </button>

                      <div className="mt-6 pt-6 border-t border-slate-800 w-full">
                        <p className="text-xs text-slate-500 mb-3">Ou use o Rclone para autorização:</p>
                        <button
                          onClick={handleRcloneAuthorize}
                          disabled={isRcloneAuthorizing || !formData.name}
                          className="w-full max-w-xs px-4 py-2.5 rounded-lg font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isRcloneAuthorizing ? (
                            <>
                              <Loader2 size={16} className="animate-spin" />
                              <span>Criando remote...</span>
                            </>
                          ) : (
                            <>
                              <RefreshCw size={16} />
                              <span>Autorizar via Rclone</span>
                            </>
                          )}
                        </button>

                        {rcloneAuthMessage && (
                          <div className={`mt-3 p-3 rounded-lg text-xs ${rcloneAuthMessage.includes('Erro') ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'}`}>
                            <pre className="whitespace-pre-wrap font-mono">{rcloneAuthMessage}</pre>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : !isLocal(formData.type) ? (
                <div className="bg-slate-950 p-5 rounded-xl border border-slate-800">
                  <h4 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2">
                    <Shield size={14} className="text-green-400" /> Credenciais de Acesso
                  </h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Usuário / Access Key <span className="text-red-400">*</span></label>
                      <input 
                        type="text" 
                        value={tempUsername}
                        onChange={(e) => setTempUsername(e.target.value)}
                        placeholder="admin"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white outline-none focus:border-primary-500 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Senha / Secret Key <span className="text-red-400">*</span></label>
                      <input 
                        type="password" 
                        value={tempPassword}
                        onChange={(e) => setTempPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white outline-none focus:border-primary-500 transition-colors"
                      />
                    </div>
                    
                    {/* SMB Specific Field */}
                    {formData.type === ConnectionType.SMB && (
                      <div className="col-span-2">
                        <label className="block text-xs text-slate-500 mb-1">Domínio / Workgroup</label>
                        <input 
                          type="text" 
                          value={tempDomain}
                          onChange={(e) => setTempDomain(e.target.value)}
                          placeholder="WORKGROUP ou CorpDomain"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white outline-none focus:border-primary-500 transition-colors"
                        />
                      </div>
                    )}

                    {/* NFS Specific Field */}
                    {formData.type === ConnectionType.NFS && (
                      <div className="col-span-2">
                         <label className="block text-xs text-slate-500 mb-1">Opções de Montagem</label>
                         <input 
                           type="text" 
                           value={tempMountOptions}
                           onChange={(e) => setTempMountOptions(e.target.value)}
                           placeholder="ex: rw,hard,intr,noatime"
                           className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white outline-none focus:border-primary-500 transition-colors font-mono"
                         />
                      </div>
                    )}
                  </div>

                  {/* Legacy Test Button - Hidden if Cloud/Local managed elsewhere but useful for SFTP/FTP */}
                </div>
              ) : (
                // Local Connection Hint
                <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 text-center text-slate-400">
                   <p className="text-sm">Para conexões locais, nenhuma autenticação adicional é necessária. Certifique-se que o app tem permissão de leitura/escrita na pasta.</p>
                </div>
              )}
              
              {/* Feedback Area for all types (Except Cloud which has its own area above) */}
              {!isCloudProvider(formData.type) && (testStatus !== 'idle' || isTesting) && (
                <div className={`mt-0 p-3 rounded-lg border flex items-start gap-3 text-sm ${
                  testStatus === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-200' : 
                  testStatus === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-200' :
                  'bg-blue-500/10 border-blue-500/30 text-blue-200'
                }`}>
                    {isTesting ? (
                      <>
                        <Loader2 size={18} className="animate-spin shrink-0" />
                        <span>Testando conexão...</span>
                      </>
                    ) : testStatus === 'success' ? (
                      <>
                        <CheckCircle size={18} className="text-green-400 shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold text-green-400">Conexão estabelecida!</p>
                          <p className="text-xs opacity-80 mt-0.5">{testMessage}</p>
                          {testLatency && (
                            <div className="flex items-center gap-1 mt-1 text-xs bg-green-500/20 w-fit px-2 py-0.5 rounded">
                              <Clock size={10} />
                              {testLatency}ms ping
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={18} className="text-red-400 shrink-0" />
                        <div className="flex-1">
                          <p className="font-semibold text-red-400">Falha na conexão</p>
                          <p className="text-xs opacity-80 mt-0.5">{testMessage}</p>
                        </div>
                      </>
                    )}
                </div>
              )}

               {/* Test Button for Non-OAuth types */}
               {!isCloudProvider(formData.type) && (
                  <div className="flex justify-end mt-2">
                    <button 
                      onClick={handleTestConnection}
                      disabled={isTesting || !formData.host || (!isLocal(formData.type) && (!tempUsername || !tempPassword))}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 rounded-lg text-xs font-medium transition-colors border border-slate-700"
                    >
                      {isLocal(formData.type) ? "Verificar Acesso" : "Testar Credenciais"}
                    </button>
                  </div>
               )}

            </div>

            <div className="p-6 border-t border-slate-800 flex justify-between items-center bg-slate-900 rounded-b-2xl">
               <div className="flex gap-2">
                 {editingId && (
                   <button
                     onClick={handleDelete}
                     className="flex items-center gap-2 text-red-400 hover:text-red-300 px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors text-sm"
                   >
                     <Trash2 size={16} /> Excluir
                   </button>
                 )}
                 {/* Disconnect button for connected non-cloud servers */}
                 {editingId && !isCloudProvider(formData.type) && !isLocal(formData.type) && formData.status === 'connected' && (
                   <button
                     onClick={handleDisconnectServer}
                     className="flex items-center gap-2 text-orange-400 hover:text-orange-300 px-3 py-2 rounded-lg hover:bg-orange-500/10 transition-colors text-sm"
                   >
                     <Unplug size={16} /> Desconectar
                   </button>
                 )}
               </div>
               <div className="flex gap-3">
                 <button 
                   onClick={() => setIsModalOpen(false)}
                   className="px-5 py-2.5 text-slate-400 hover:text-white transition-colors"
                 >
                   Cancelar
                 </button>
                 <button
                   onClick={handleSave}
                   disabled={!formData.name || (!editingId && testStatus !== 'success')}
                   className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                 >
                   <Save size={18} /> {editingId ? 'Salvar Alterações' : 'Salvar Conexão'}
                 </button>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Reconnect Confirmation Dialog */}
      {showReconnectDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 w-full max-w-md rounded-xl border border-slate-700 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-primary-500/10 rounded-full">
                  <RefreshCw className="text-primary-400" size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Reconectar ao Servidor?</h3>
                  <p className="text-sm text-slate-400">Os dados foram salvos com sucesso</p>
                </div>
              </div>

              <p className="text-sm text-slate-300 mb-6">
                Deseja testar a conexão usando os dados atualizados? Isso verificará se as credenciais e configurações estão corretas.
              </p>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={handleReconnectSkip}
                  className="px-4 py-2 text-slate-400 hover:text-white transition-colors text-sm"
                >
                  Não, fechar
                </button>
                <button
                  onClick={handleReconnectConfirm}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2 text-sm"
                >
                  <RefreshCw size={16} /> Reconectar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectionManager;
