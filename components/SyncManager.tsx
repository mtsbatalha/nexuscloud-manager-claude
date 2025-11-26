import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Clock, ArrowRight, Play, Pause, Settings, Plus, X, Calendar, Filter, RefreshCw, Database, CheckCircle, AlertCircle, ClipboardList, AlertTriangle, Loader2 } from 'lucide-react';
import { SyncJob, Connection, SyncLogEntry } from '../types';

interface SyncManagerProps {
  connections?: Connection[];
}

const SyncManager: React.FC<SyncManagerProps> = ({ connections = [] }) => {
  const [activeTab, setActiveTab] = useState<'jobs' | 'history'>('jobs');
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Form State
  const [jobName, setJobName] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [destId, setDestId] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [time, setTime] = useState('00:00');
  const [patterns, setPatterns] = useState('*.tmp, .DS_Store');
  const [syncType, setSyncType] = useState<'one-way' | 'two-way'>('one-way');

  const token = localStorage.getItem('token');

  // Fetch jobs and logs from API
  const fetchData = useCallback(async () => {
    if (!token) return;
    
    try {
      setLoading(true);
      const [jobsRes, logsRes] = await Promise.all([
        fetch('/api/sync/jobs', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/sync/logs', { headers: { Authorization: `Bearer ${token}` } })
      ]);

      if (jobsRes.ok) {
        const jobsData = await jobsRes.json();
        setJobs(jobsData);
      }
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setLogs(logsData);
      }
      setError(null);
      setLoading(false);
    } catch (e) {
      console.error('Error fetching sync data:', e);
      setError('Erro ao carregar dados de sincronização');
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [token]);

  // Separate polling effect to avoid infinite loops
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!token) return;
      try {
        const jobsRes = await fetch('/api/sync/jobs', { headers: { Authorization: `Bearer ${token}` } });
        if (jobsRes.ok) {
          const jobsData = await jobsRes.json();
          setJobs(jobsData);
        }
      } catch (e) {
        console.error('Error polling sync data:', e);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [token]);

  // Fallback to look up connection details if connections prop isn't populated yet or for old jobs
  const getConnectionName = (id: string) => connections.find(c => c.id === id)?.name || 'Desconhecido';
  const getConnectionType = (id: string) => connections.find(c => c.id === id)?.type || '';

  const handleCreateJob = async () => {
    if (!token) return;

    try {
      const res = await fetch('/api/sync/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: jobName || 'Nova Tarefa',
          sourceId,
          destinationId: destId,
          type: syncType,
          frequency,
          scheduledTime: time,
          excludePatterns: patterns.split(',').map(p => p.trim())
        })
      });

      if (res.ok) {
        const newJob = await res.json();
        setJobs([...jobs, newJob]);
        setIsModalOpen(false);
        resetForm();
      } else {
        const err = await res.json();
        alert(err.error || 'Erro ao criar tarefa');
      }
    } catch (e) {
      console.error('Error creating job:', e);
      alert('Erro ao criar tarefa');
    }
  };

  const resetForm = () => {
    setJobName('');
    setSourceId('');
    setDestId('');
    setFrequency('daily');
    setTime('00:00');
    setPatterns('*.tmp, .DS_Store');
  };

  const toggleJobStatus = async (id: string) => {
    if (!token) return;
    
    const job = jobs.find(j => j.id === id);
    if (!job) return;

    try {
      if (job.status === 'running') {
        // Stop the job
        await fetch(`/api/sync/jobs/${id}/stop`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
        setJobs(jobs.map(j => j.id === id ? { ...j, status: 'idle', progress: 0 } : j));
      } else {
        // Start the job
        const res = await fetch(`/api/sync/jobs/${id}/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          setJobs(jobs.map(j => j.id === id ? { ...j, status: 'running', progress: 0 } : j));
        }
      }
    } catch (e) {
      console.error('Error toggling job status:', e);
    }
  };

  const deleteJob = async (id: string) => {
    if (!token) return;

    try {
      const res = await fetch(`/api/sync/jobs/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        setJobs(jobs.filter(j => j.id !== id));
      }
    } catch (e) {
      console.error('Error deleting job:', e);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-blue-400 border-blue-500/30 bg-blue-500/10';
      case 'completed': return 'text-green-400 border-green-500/30 bg-green-500/10';
      case 'failed': return 'text-red-400 border-red-500/30 bg-red-500/10';
      default: return 'text-slate-400 border-slate-700 bg-slate-800';
    }
  };

  const formatSize = (bytes: number) => {
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-primary-500" size={32} />
        <span className="ml-3 text-slate-400">Carregando sincronizações...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header Area */}
      <div className="p-8 pb-0">
        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <Activity className="text-primary-500" />
              Central de Sincronização
            </h2>
            <p className="text-slate-400 mt-2">Gerencie backups automáticos e monitore o histórico.</p>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-lg shadow-primary-900/20"
          >
            <Plus size={18} />
            Nova Tarefa
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-6 border-b border-slate-800">
          <button 
            onClick={() => setActiveTab('jobs')}
            className={`pb-4 text-sm font-medium transition-colors relative ${
              activeTab === 'jobs' ? 'text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Tarefas Agendadas
            {activeTab === 'jobs' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-500 rounded-t-full"></div>}
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`pb-4 text-sm font-medium transition-colors relative flex items-center gap-2 ${
              activeTab === 'history' ? 'text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <ClipboardList size={16} />
            Histórico de Execução
            {activeTab === 'history' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-500 rounded-t-full"></div>}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="p-8 pt-6 flex-1 overflow-y-auto">
        
        {/* Loading State - only on first load */}
        {loading && jobs.length === 0 && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Loader2 className="animate-spin mx-auto mb-4 text-primary-500" size={32} />
              <p className="text-slate-400">Carregando sincronizações...</p>
            </div>
          </div>
        )}

        {/* JOBS VIEW */}
        {activeTab === 'jobs' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {jobs.map((job) => (
              <div key={job.id} className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-slate-600 transition-all">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                       <h3 className="font-bold text-lg text-white">{job.name}</h3>
                       <span className={`text-xs px-2 py-1 rounded border ${getStatusColor(job.status)} uppercase font-bold`}>
                         {job.status === 'idle' ? 'Aguardando' : job.status}
                       </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Clock size={12} />
                      {job.frequency === 'manual' ? 'Execução Manual' : 
                       job.frequency === 'realtime' ? 'Tempo Real' : 
                       `Agendado: ${job.frequency} às ${job.scheduledTime}`}
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <button 
                      onClick={() => toggleJobStatus(job.id)}
                      className={`p-2 rounded-lg transition-colors ${job.status === 'running' ? 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30' : 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'}`}
                    >
                      {job.status === 'running' ? <Pause size={18} /> : <Play size={18} />}
                    </button>
                    <button onClick={() => deleteJob(job.id)} className="p-2 bg-slate-800 text-slate-400 hover:text-red-400 rounded-lg transition-colors">
                      <X size={18} />
                    </button>
                  </div>
                </div>

                {/* Connection Flow */}
                <div className="flex items-center gap-4 bg-slate-950 p-4 rounded-lg border border-slate-800 mb-4">
                   <div className="flex-1">
                      <p className="text-xs text-slate-500 mb-1">Origem ({getConnectionType(job.sourceId)})</p>
                      <p className="text-sm font-medium text-slate-200 truncate">{getConnectionName(job.sourceId)}</p>
                   </div>
                   <div className="text-slate-600">
                      {job.type === 'two-way' ? <RefreshCw size={20} /> : <ArrowRight size={20} />}
                   </div>
                   <div className="flex-1 text-right">
                      <p className="text-xs text-slate-500 mb-1">Destino ({getConnectionType(job.destinationId)})</p>
                      <p className="text-sm font-medium text-slate-200 truncate">{getConnectionName(job.destinationId)}</p>
                   </div>
                </div>

                {/* Progress or Details */}
                {job.status === 'running' ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Sincronizando...</span>
                      <span>{Math.round((job.filesProcessed / job.totalFiles) * 100) || 0}%</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary-500 animate-pulse" 
                        style={{ width: `${(job.filesProcessed / job.totalFiles) * 100 || 10}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-slate-500 text-right">{job.filesProcessed}/{job.totalFiles} arquivos</p>
                  </div>
                ) : (
                  <div className="flex justify-between items-center text-xs text-slate-500 border-t border-slate-800 pt-4">
                    <div className="flex gap-3">
                       {job.excludePatterns.length > 0 && (
                         <span className="flex items-center gap-1" title={`Filtros: ${job.excludePatterns.join(', ')}`}>
                           <Filter size={12} /> {job.excludePatterns.length} filtros
                         </span>
                       )}
                    </div>
                    <div>
                      <span className="mr-3">Última: {job.lastRun || '-'}</span>
                      <span>Próxima: {job.nextRun || '-'}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {jobs.length === 0 && !loading && (
              <div className="text-center py-12 text-slate-500">
                <Activity size={32} className="mx-auto mb-3 opacity-50" />
                <p>Nenhuma tarefa de sincronização criada</p>
              </div>
            )}
          </div>
        )}

        {/* HISTORY VIEW */}
        {activeTab === 'history' && (
          <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-950 text-slate-400 font-medium border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Tarefa</th>
                    <th className="px-6 py-4">Data/Hora</th>
                    <th className="px-6 py-4">Fluxo</th>
                    <th className="px-6 py-4">Dados</th>
                    <th className="px-6 py-4">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {logs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4">
                        {log.status === 'success' && <CheckCircle className="text-green-400" size={20} />}
                        {log.status === 'failed' && <AlertCircle className="text-red-400" size={20} />}
                        {log.status === 'warning' && <AlertTriangle className="text-yellow-400" size={20} />}
                      </td>
                      <td className="px-6 py-4 font-medium text-white">{log.jobName}</td>
                      <td className="px-6 py-4 text-slate-400">
                        <div className="flex flex-col">
                          <span>{formatDate(log.startTime)}</span>
                          <span className="text-xs text-slate-600">Duração: {Math.floor((new Date(log.endTime).getTime() - new Date(log.startTime).getTime()) / 1000)}s</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-400">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="max-w-[100px] truncate" title={log.sourceName}>{log.sourceName}</span>
                          <ArrowRight size={12} className="text-slate-600" />
                          <span className="max-w-[100px] truncate" title={log.destinationName}>{log.destinationName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-400">
                        <div className="flex flex-col">
                          <span>{formatSize(log.sizeTransferred)}</span>
                          <span className="text-xs text-slate-600">{log.filesTransferred} arquivos</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs ${
                          log.status === 'failed' ? 'text-red-300' : 
                          log.status === 'warning' ? 'text-yellow-300' : 'text-slate-500'
                        }`}>
                          {log.details}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {logs.length === 0 && (
              <div className="p-12 text-center text-slate-500">
                Nenhum registro de atividade encontrado.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Job Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 w-full max-w-xl rounded-2xl border border-slate-700 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-xl font-bold text-white">Configurar Nova Sincronização</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar">
              {/* Basic Info */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Nome da Tarefa</label>
                <input 
                  type="text" 
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  placeholder="Ex: Backup Diário de Fotos"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>

              {/* Source & Dest */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Origem</label>
                  <select 
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white outline-none"
                  >
                    <option value="">Selecione...</option>
                    {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                   <label className="block text-sm font-medium text-slate-400 mb-2">Destino</label>
                   <select 
                    value={destId}
                    onChange={(e) => setDestId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white outline-none"
                   >
                    <option value="">Selecione...</option>
                    {connections.filter(c => c.id !== sourceId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                   </select>
                </div>
              </div>

              {/* Type */}
              <div className="flex gap-4">
                 <label className={`flex-1 cursor-pointer border rounded-xl p-4 flex items-center gap-3 transition-colors ${syncType === 'one-way' ? 'bg-primary-600/10 border-primary-500' : 'bg-slate-800 border-slate-700'}`}>
                    <input type="radio" name="type" className="hidden" checked={syncType === 'one-way'} onChange={() => setSyncType('one-way')} />
                    <Database className={syncType === 'one-way' ? 'text-primary-500' : 'text-slate-500'} />
                    <div>
                      <p className="font-medium text-slate-200">Backup (One-way)</p>
                      <p className="text-xs text-slate-500">Origem sobrescreve destino</p>
                    </div>
                 </label>
                 <label className={`flex-1 cursor-pointer border rounded-xl p-4 flex items-center gap-3 transition-colors ${syncType === 'two-way' ? 'bg-primary-600/10 border-primary-500' : 'bg-slate-800 border-slate-700'}`}>
                    <input type="radio" name="type" className="hidden" checked={syncType === 'two-way'} onChange={() => setSyncType('two-way')} />
                    <RefreshCw className={syncType === 'two-way' ? 'text-primary-500' : 'text-slate-500'} />
                    <div>
                      <p className="font-medium text-slate-200">Sincronia (Two-way)</p>
                      <p className="text-xs text-slate-500">Mantém ambos atualizados</p>
                    </div>
                 </label>
              </div>

              {/* Schedule */}
              <div className="border-t border-slate-800 pt-4">
                <h4 className="text-white font-medium mb-4 flex items-center gap-2">
                   <Calendar size={18} className="text-purple-400" /> Agendamento
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Frequência</label>
                    <select 
                      value={frequency} 
                      onChange={(e) => setFrequency(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-sm text-white outline-none"
                    >
                      <option value="manual">Manual</option>
                      <option value="realtime">Tempo Real</option>
                      <option value="daily">Diário</option>
                      <option value="weekly">Semanal</option>
                      <option value="monthly">Mensal</option>
                    </select>
                  </div>
                  {(frequency === 'daily' || frequency === 'weekly' || frequency === 'monthly') && (
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Horário</label>
                      <input 
                        type="time" 
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-sm text-white outline-none"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Filters */}
              <div className="border-t border-slate-800 pt-4">
                <h4 className="text-white font-medium mb-4 flex items-center gap-2">
                   <Filter size={18} className="text-purple-400" /> Regras de Exclusão
                </h4>
                <div>
                   <label className="text-xs text-slate-500 block mb-1">Padrões para ignorar (separados por vírgula)</label>
                   <input 
                    type="text" 
                    value={patterns}
                    onChange={(e) => setPatterns(e.target.value)}
                    placeholder="*.tmp, .git, node_modules"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-white outline-none font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 flex justify-end gap-3 bg-slate-900 rounded-b-2xl">
               <button 
                 onClick={() => setIsModalOpen(false)}
                 className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
               >
                 Cancelar
               </button>
               <button 
                 onClick={handleCreateJob}
                 disabled={!jobName || !sourceId || !destId}
                 className="px-6 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg font-medium transition-colors"
               >
                 Criar Tarefa
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncManager;