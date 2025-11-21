import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Trash2, Shield, Mail, Search, Loader2 } from 'lucide-react';
import { User } from '../types';

const UserManager: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  
  // New User Form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [createLoading, setCreateLoading] = useState(false);

  const token = localStorage.getItem('nexus_token');

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: newName, email: newEmail, password: newPassword, role: newRole })
      });
      
      if (res.ok) {
        await fetchUsers();
        setShowForm(false);
        setNewName('');
        setNewEmail('');
        setNewPassword('');
      } else {
        alert('Erro ao criar usuário');
      }
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Tem certeza?')) return;
    try {
      await fetch('/api/users/' + id, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setUsers(users.filter(u => u.id !== id));
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users className="text-primary-500" />
            Gestão de Usuários
          </h2>
          <p className="text-slate-400 mt-2">Gerencie o acesso e permissões da equipe.</p>
        </div>
        <button 
          onClick={() => setShowForm(!showForm)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 shadow-lg shadow-primary-900/20 transition-colors"
        >
          <UserPlus size={18} />
          Novo Usuário
        </button>
      </div>

      {showForm && (
        <div className="mb-8 bg-slate-900 border border-slate-800 rounded-xl p-6 animate-in slide-in-from-top-2">
          <h3 className="text-lg font-semibold text-white mb-4">Cadastrar Novo Membro</h3>
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input 
              type="text" placeholder="Nome Completo" required
              value={newName} onChange={e => setNewName(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-white outline-none"
            />
            <input 
              type="email" placeholder="Email" required
              value={newEmail} onChange={e => setNewEmail(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-white outline-none"
            />
            <input 
              type="password" placeholder="Senha Temporária" required
              value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-white outline-none"
            />
            <select 
              value={newRole} onChange={(e: any) => setNewRole(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-white outline-none"
            >
              <option value="user">Usuário Padrão</option>
              <option value="admin">Administrador</option>
            </select>
            <div className="col-span-2 flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-400 hover:text-white">Cancelar</button>
              <button type="submit" disabled={createLoading} className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg">
                {createLoading ? 'Salvando...' : 'Cadastrar'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
            <tr>
              <th className="px-6 py-4">Usuário</th>
              <th className="px-6 py-4">Função</th>
              <th className="px-6 py-4">Data Cadastro</th>
              <th className="px-6 py-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr><td colSpan={4} className="p-8 text-center"><Loader2 className="animate-spin mx-auto text-primary-500" /></td></tr>
            ) : users.map(user => (
              <tr key={user.id} className="hover:bg-slate-800/50">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 font-bold">
                      {user.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-white font-medium">{user.name}</p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs border ${
                    user.role === 'admin' 
                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' 
                    : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  }`}>
                    {user.role === 'admin' ? 'Administrador' : 'Membro'}
                  </span>
                </td>
                <td className="px-6 py-4 text-slate-400">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 text-right">
                  <button 
                    onClick={() => handleDeleteUser(user.id)}
                    className="p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UserManager;