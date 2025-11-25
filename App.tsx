import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import FileExplorer from './components/FileExplorer';
import Dashboard from './components/Dashboard';
import PreviewModal from './components/PreviewModal';
import Copilot from './components/Copilot';
import DuplicateManager from './components/DuplicateManager';
import SyncManager from './components/SyncManager';
import ConnectionManager from './components/ConnectionManager';
import UserManager from './components/UserManager';
import Login from './components/Login';
import TransferProgress from './components/TransferProgress';
import { TransferProvider, useTransfer } from './contexts/TransferContext';
import { Connection, FileItem, User, AuthResponse } from './types';
import { MessageSquare, Plus } from 'lucide-react';

const AppContent: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [activeView, setActiveView] = useState('dashboard');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeConnection, setActiveConnection] = useState<Connection | null>(null);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [currentFiles, setCurrentFiles] = useState<FileItem[]>([]);
  const [navigateToPath, setNavigateToPath] = useState<string | null>(null);

  const { setOnNavigate } = useTransfer();

  // Set up navigation callback for transfer progress
  useEffect(() => {
    const handleNavigate = useCallback((connId: string, path: string) => {
      const conn = connections.find(c => c.id === connId);
      if (conn) {
        setActiveConnection(conn);
        setActiveView('files');
        setNavigateToPath(path);
      }
    }, [connections]);

    setOnNavigate(handleNavigate);
  }, [connections, setOnNavigate]);

  // Helper to check if token is expired
  const isTokenExpired = (token: string): boolean => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 < Date.now();
    } catch {
      return true;
    }
  };

  // Check auth on load
  useEffect(() => {
    const token = localStorage.getItem('nexus_token');
    const userStr = localStorage.getItem('nexus_user');
    if (token && userStr) {
      // Check if token is expired
      if (isTokenExpired(token)) {
        localStorage.removeItem('nexus_token');
        localStorage.removeItem('nexus_user');
        return;
      }

      const user = JSON.parse(userStr);
      setIsAuthenticated(true);
      setCurrentUser(user);

      // Load connections from localStorage for this user
      const savedConnections = localStorage.getItem(`nexus_connections_${user.id}`);
      if (savedConnections) {
        try {
          setConnections(JSON.parse(savedConnections));
        } catch (e) {
          console.error('Error loading saved connections:', e);
          setConnections([]);
        }
      } else {
        // First time user - start with empty connections
        setConnections([]);
      }
    }
  }, []);

  // Auto-logout when token expires
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkToken = () => {
      const token = localStorage.getItem('nexus_token');
      if (!token || isTokenExpired(token)) {
        handleLogout();
      }
    };

    // Check every minute
    const interval = setInterval(checkToken, 60000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Save connections to localStorage whenever they change
  useEffect(() => {
    if (currentUser && connections.length >= 0) {
      localStorage.setItem(`nexus_connections_${currentUser.id}`, JSON.stringify(connections));
    }
  }, [connections, currentUser]);

  
  const handleLogin = (data: AuthResponse) => {
    localStorage.setItem('nexus_token', data.token);
    localStorage.setItem('nexus_user', JSON.stringify(data.user));
    setCurrentUser(data.user);
    setIsAuthenticated(true);

    // Load connections for this user
    const savedConnections = localStorage.getItem(`nexus_connections_${data.user.id}`);
    if (savedConnections) {
      try {
        setConnections(JSON.parse(savedConnections));
      } catch (e) {
        console.error('Error loading saved connections:', e);
        setConnections([]);
      }
    } else {
      // First time user - start with empty connections
      setConnections([]);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('nexus_token');
    localStorage.removeItem('nexus_user');
    setIsAuthenticated(false);
    setCurrentUser(null);
  };

  const handleViewChange = (view: string) => {
    if (view === 'ai-chat') {
      setIsCopilotOpen(!isCopilotOpen);
    } else {
      setActiveView(view);
      if (view === 'dashboard') setActiveConnection(null);
    }
  };

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLogin} />;
  }

  const renderContent = () => {
    switch (activeView) {
      case 'dashboard':
        return <Dashboard connections={connections} />;
      case 'users':
        return currentUser?.role === 'admin' ? <UserManager /> : <div className="p-8 text-red-400">Acesso Negado</div>;
      case 'cleanup':
        return <DuplicateManager connections={connections} />;
      case 'files':
        return (
          <div className="flex h-full">
            <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
               <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                 <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Conexões</span>
                 <button 
                   onClick={() => setActiveView('connections')}
                   className="text-primary-400 hover:text-primary-300"
                   title="Gerenciar Conexões"
                 >
                   <Plus size={16} />
                 </button>
               </div>
               <div className="flex-1 overflow-y-auto p-2 space-y-1">
                 {connections.length === 0 && (
                   <div className="p-4 text-center text-xs text-slate-500">
                     Nenhuma conexão. Adicione uma no menu Conexões.
                   </div>
                 )}
                 {connections.map(conn => (
                   <button
                    key={conn.id}
                    onClick={() => setActiveConnection(conn)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between ${
                      activeConnection?.id === conn.id 
                      ? 'bg-primary-600 text-white' 
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                   >
                     <span className="truncate">{conn.name}</span>
                     <span className={`w-1.5 h-1.5 rounded-full ${conn.status === 'connected' ? 'bg-green-400' : 'bg-red-400'}`} />
                   </button>
                 ))}
               </div>
            </div>
            <div className="flex-1 h-full overflow-hidden">
              <FileExplorer
                activeConnection={activeConnection}
                connections={connections}
                onPreview={setPreviewFile}
                onFilesChange={setCurrentFiles}
                navigateToPath={navigateToPath}
                onNavigateComplete={() => setNavigateToPath(null)}
              />
            </div>
          </div>
        );
      case 'sync':
        return <SyncManager connections={connections} />;
      case 'connections':
         return (
          <ConnectionManager 
            connections={connections} 
            onUpdateConnections={setConnections} 
          />
         );
      default:
        return <div className="p-8 text-white">Selecione uma opção</div>;
    }
  };

  return (
      <div className="flex h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden">
        <Sidebar
          activeView={activeView}
          setActiveView={handleViewChange}
          currentUser={currentUser}
          onLogout={handleLogout}
        />

        <main className="flex-1 relative overflow-hidden bg-slate-950">
          {renderContent()}

          {!isCopilotOpen && (
            <button
              onClick={() => setIsCopilotOpen(true)}
              className="fixed bottom-6 right-6 w-14 h-14 bg-purple-600 hover:bg-purple-500 text-white rounded-full shadow-lg shadow-purple-900/40 flex items-center justify-center transition-transform hover:scale-110 z-40"
              title="Abrir Nexus Copilot"
            >
              <MessageSquare size={24} />
            </button>
          )}

          <Copilot
            isOpen={isCopilotOpen}
            onClose={() => setIsCopilotOpen(false)}
            currentConnection={activeConnection}
            currentFiles={currentFiles}
          />
        </main>

        {previewFile && (
          <PreviewModal
            file={previewFile}
            onClose={() => setPreviewFile(null)}
            activeConnection={activeConnection}
          />
        )}

        {/* Global Transfer Progress */}
        <TransferProgress />
      </div>
  );
};

const App: React.FC = () => (
  <TransferProvider>
    <AppContent />
  </TransferProvider>
);

export default App;