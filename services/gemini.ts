import Groq from 'groq-sdk';
import { FileItem, Connection, DuplicateCandidate } from '../types';

// Initialize Groq client
const apiKey = import.meta.env.VITE_GROQ_API_KEY || '';
const groq = apiKey ? new Groq({ apiKey, dangerouslyAllowBrowser: true }) : null;

export const generateFileSummary = async (fileName: string, content: string): Promise<string> => {
  if (!groq) return "Configure VITE_GROQ_API_KEY no .env. Obtenha grátis em: https://console.groq.com/keys";

  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: `Resuma o seguinte conteúdo do arquivo "${fileName}" de forma concisa, destacando pontos chave. Se for código, explique o que faz:\n\n${content}` }],
      max_tokens: 500
    });
    return result.choices[0]?.message?.content || "Não foi possível gerar o resumo.";
  } catch (error) {
    console.error("Groq Error:", error);
    return "Erro ao conectar com a IA.";
  }
};

export const getAIChatResponse = async (
  userMessage: string,
  context: { currentConnection?: Connection, currentFiles: FileItem[] }
): Promise<string> => {
  if (!groq) return "Configure VITE_GROQ_API_KEY no .env para usar o Copilot. Obtenha grátis em: https://console.groq.com/keys";

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  };

  const fileList = context.currentFiles.map(f =>
    `- ${f.name} (${f.type}, ${formatSize(f.size)}, modificado: ${new Date(f.modifiedAt).toLocaleDateString()})`
  ).join('\n');

  const totalSize = context.currentFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  const folders = context.currentFiles.filter(f => f.type === 'folder').length;
  const files = context.currentFiles.filter(f => f.type === 'file').length;

  const systemPrompt = `Você é o Nexus Copilot, assistente IA de um gerenciador de arquivos multi-cloud.

CONTEXTO ATUAL:
- Conexão: ${context.currentConnection?.name || 'Nenhuma'} (${context.currentConnection?.type || 'N/A'})
- Host: ${context.currentConnection?.host || 'N/A'}
- Total: ${files} arquivos, ${folders} pastas (${formatSize(totalSize)})

ARQUIVOS NA PASTA ATUAL:
${fileList || 'Pasta vazia'}

CAPACIDADES:
- Buscar arquivos por nome, tipo ou data
- Sugerir organização de pastas
- Identificar arquivos grandes ou duplicados
- Explicar tipos de arquivo

INSTRUÇÕES:
1. Seja conciso e direto
2. Use listas quando apropriado
3. Se perguntarem sobre um arquivo específico, verifique se existe na lista
4. Responda em português brasileiro`;

  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_tokens: 800
    });
    return result.choices[0]?.message?.content || "Desculpe, não consegui processar sua solicitação.";
  } catch (error: any) {
    console.error("Groq Copilot error:", error);
    const errMsg = error.message || error.toString();
    if (errMsg.includes('rate') || errMsg.includes('429')) {
      return "Limite de requisições atingido. Aguarde e tente novamente.";
    }
    return `Erro: ${errMsg.substring(0, 100)}`;
  }
};

export const suggestOrganization = async (files: FileItem[]): Promise<string> => {
  if (!groq) return "Configure a API Key para sugestões automáticas.";

  const fileList = files.map(f => f.name).join(', ');

  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: `Dada a seguinte lista de arquivos: [${fileList}], sugira uma estrutura de pastas lógica para organizá-los. Responda apenas com a estrutura sugerida em formato de lista.` }],
      max_tokens: 500
    });
    return result.choices[0]?.message?.content || "Sem sugestões no momento.";
  } catch (error) {
    return "Erro ao gerar sugestão.";
  }
};

export const detectDuplicatesWithAI = async (files: FileItem[]): Promise<DuplicateCandidate[]> => {
  if (!groq) {
    console.warn("Sem API Key. Retornando mocks de duplicatas.");
    const mockItems = [
      {
        fileA: files.find(f => f.name.includes('logo')) || files[0],
        fileB: files.find(f => f.name.includes('FINAL')) || files[1],
        similarity: 98,
        reason: "Tamanho de arquivo idêntico e nome semanticamente similar.",
        suggestion: 'keep_b' as DuplicateCandidate['suggestion']
      }
    ];
    return mockItems.filter((d): d is DuplicateCandidate => !!(d.fileA && d.fileB));
  }

  const fileData = files
    .filter(f => f.type === 'file')
    .map(f => ({
      id: f.id,
      name: f.name,
      size: f.size,
      date: f.modifiedAt,
      conn: f.connectionName
    }));

  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{
        role: 'user',
        content: `Analise esta lista de arquivos e identifique duplicatas prováveis.
Retorne APENAS um JSON Array válido, sem texto adicional.

Arquivos: ${JSON.stringify(fileData)}

Formato esperado:
[{"fileA_id":"id1","fileB_id":"id2","similarity":95,"reason":"explicação curta","suggestion":"keep_a ou keep_b ou manual"}]

Se não houver duplicatas, retorne: []`
      }],
      max_tokens: 1000
    });

    const responseText = result.choices[0]?.message?.content || '[]';

    // Extract JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const jsonResponse = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(jsonResponse)) return [];

    const results: DuplicateCandidate[] = jsonResponse
      .map((match: any) => {
        const fileA = files.find(f => f.id === match.fileA_id);
        const fileB = files.find(f => f.id === match.fileB_id);
        if (!fileA || !fileB) return null;
        return {
          fileA,
          fileB,
          similarity: match.similarity,
          reason: match.reason,
          suggestion: match.suggestion as 'keep_a' | 'keep_b' | 'manual'
        };
      })
      .filter((item): item is DuplicateCandidate => item !== null);

    return results;

  } catch (error) {
    console.error("Erro ao detectar duplicatas:", error);
    return [];
  }
};
