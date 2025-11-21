import React from 'react';
import { HardDrive, Cloud, Settings, Activity, MessageSquare, Layers, LayoutDashboard, Sparkles, Users, LogOut } from 'lucide-react';
import { User } from '../types';

interface SidebarProps {
  activeView: string;
  setActiveView: (view: string) => void;
  currentUser: User | null;
  onLogout: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeView, setActiveView, currentUser, onLogout }) => {
  const navItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'files', icon: HardDrive, label: 'Arquivos' },
    { id: 'cleanup', icon: Sparkles, label: 'Limpeza IA', highlight: false },
    { id: 'sync', icon: Activity, label: 'Sincronização' },
    { id: 'connections', icon: Cloud, label: 'Conexões' },
    { id: 'ai-chat', icon: MessageSquare, label: 'Nexus AI', highlight: true },
  ];

  if (currentUser?.role === 'admin') {
    navItems.push({ id: 'users', icon: Users, label: 'Usuários' });
  }

  navItems.push({ id: 'settings', icon: Settings, label: 'Configurações' });

  return (
    <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-full text-slate-300 transition-all duration-300">
      <div className="p-6 flex items-center gap-3 text-white">
        <div className="bg-primary-600 p-2 rounded-lg">
          <Layers size={24} />
        </div>
        <div>
           <h1 className="font-bold text-lg tracking-tight">NexusCloud</h1>
           <p className="text-[10px] text-slate-500 uppercase tracking-wider">{currentUser?.role || 'Viewer'}</p>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-2 mt-4">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 font-medium ${
              activeView === item.id
                ? 'bg-primary-600/10 text-primary-500 border border-primary-600/20 shadow-sm'
                : 'hover:bg-slate-800 hover:text-white'
            } ${item.highlight ? 'text-purple-400 hover:text-purple-300' : ''}`}
          >
            <item.icon size={20} className={item.highlight ? "text-purple-500" : ""} />
            <span>{item.label}</span>
            {item.highlight && (
              <span className="ml-auto text-[10px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full font-bold">
                BETA
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-800 space-y-4">
        <div className="bg-slate-800/50 p-3 rounded-lg">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-xs">
               {currentUser?.name.charAt(0) || 'U'}
             </div>
             <div className="overflow-hidden">
               <p className="text-sm text-white font-medium truncate">{currentUser?.name}</p>
               <p className="text-xs text-slate-500 truncate">{currentUser?.email}</p>
             </div>
          </div>
        </div>
        
        <button 
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          <LogOut size={14} /> Sair do Sistema
        </button>
      </div>
    </div>
  );
};

export default Sidebar;