import dotenv from 'dotenv';
// Load .env.local first, then .env as fallback
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import compression from 'compression';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import bodyParser from 'body-parser';
import { Client as SSHClient } from 'ssh2';
import * as ftp from 'basic-ftp';
import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import SMB2 from '@marsaud/smb2';
import crypto from 'crypto';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nexus-secret-key-change-me';
const DATA_FILE = path.join(__dirname, 'users.json');
const CREDENTIALS_FILE = path.join(__dirname, 'credentials.enc.json');

// Encryption key derived from JWT_SECRET (32 bytes for AES-256)
const ENCRYPTION_KEY = crypto.scryptSync(JWT_SECRET, 'nexus-salt', 32);

// --- Encryption Utilities ---

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted,
    authTag: authTag.toString('hex')
  };
}

function decrypt(encryptedObj) {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      ENCRYPTION_KEY,
      Buffer.from(encryptedObj.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(encryptedObj.authTag, 'hex'));
    let decrypted = decipher.update(encryptedObj.encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Decryption error:', e.message);
    return null;
  }
}

// --- Credentials Storage ---

const getCredentials = () => {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading credentials:', e.message);
  }
  return {};
};

const saveCredentials = (credentials) => {
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
};

const getConnectionCredentials = (connectionId, userId) => {
  const credentials = getCredentials();
  const key = `${userId}:${connectionId}`;
  const stored = credentials[key];

  if (!stored) return null;

  try {
    const decryptedUsername = decrypt(stored.username);
    const decryptedPassword = decrypt(stored.password);

    if (!decryptedUsername || !decryptedPassword) return null;

    return {
      username: decryptedUsername,
      password: decryptedPassword,
      port: stored.port,
      secure: stored.secure
    };
  } catch (e) {
    return null;
  }
};

const saveConnectionCredentials = (connectionId, userId, username, password, port, secure) => {
  const credentials = getCredentials();
  const key = `${userId}:${connectionId}`;

  credentials[key] = {
    username: encrypt(username),
    password: encrypt(password),
    port: port,
    secure: secure,
    updatedAt: new Date().toISOString()
  };

  saveCredentials(credentials);
};

const deleteConnectionCredentials = (connectionId, userId) => {
  const credentials = getCredentials();
  const key = `${userId}:${connectionId}`;

  if (credentials[key]) {
    delete credentials[key];
    saveCredentials(credentials);
    return true;
  }
  return false;
};

// OAuth Configuration
const OAUTH_CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/userinfo.email']
  },
  dropbox: {
    clientId: process.env.DROPBOX_CLIENT_ID,
    clientSecret: process.env.DROPBOX_CLIENT_SECRET,
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    userInfoUrl: 'https://api.dropboxapi.com/2/users/get_current_account',
    scopes: []
  },
  onedrive: {
    clientId: process.env.ONEDRIVE_CLIENT_ID,
    clientSecret: process.env.ONEDRIVE_CLIENT_SECRET,
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['Files.Read', 'User.Read', 'offline_access']
  }
};

const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/api/oauth/callback';

// Store OAuth states temporarily (in production, use Redis or database)
const oauthStates = new Map();

// Configuração de Upload
const upload = multer({ dest: path.join(__dirname, 'uploads_temp') });

// Middlewares
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://generativelanguage.googleapis.com"],
      fontSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Debug middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] ${req.method} ${req.url}`);
  next();
});

// Servir arquivos estáticos da build do Vite (pasta dist)
// Isso é crucial: o Dockerfile copia o build para ./dist
app.use(express.static(path.join(__dirname, 'dist')));

// --- Sistema de Usuários (Simples JSON DB) ---

if (!fs.existsSync(DATA_FILE)) {
  const initialUsers = [
    {
      id: '1',
      name: 'Administrador',
      email: 'admin@nexus.com',
      passwordHash: bcrypt.hashSync('admin123', 10),
      role: 'admin',
      createdAt: new Date().toISOString()
    }
  ];
  fs.writeFileSync(DATA_FILE, JSON.stringify(initialUsers, null, 2));
}

const getUsers = () => {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
};
const saveUsers = (users) => fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));

// --- Rotas de Autenticação ---

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const users = getUsers();
    const user = users.find(u => u.email === email);

    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    const { passwordHash, ...userSafe } = user;
    res.json({ token, user: userSafe });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;

  // Validação básica
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
  }

  const users = getUsers();

  // Verificar se email já existe
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'Este email já está cadastrado' });
  }

  // Criar novo usuário
  const newUser = {
    id: Date.now().toString(),
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'user',
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers(users);

  // Gerar token e retornar
  const token = jwt.sign({ id: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: '8h' });
  const { passwordHash: _, ...userSafe } = newUser;
  res.json({ token, user: userSafe });
});

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.log('[Auth] No authorization header provided');
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    console.log('[Auth] No token in authorization header');
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.log('[Auth] Token verification failed:', err.message);
    res.status(403).json({ error: 'Token inválido' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
  next();
};

// --- Rotas de Gestão de Usuários ---

app.get('/api/users', authenticate, requireAdmin, (req, res) => {
  const users = getUsers();
  res.json(users.map(({ passwordHash, ...u }) => u));
});

app.post('/api/users', authenticate, requireAdmin, (req, res) => {
  const { name, email, password, role } = req.body;
  const users = getUsers();
  
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'Email já cadastrado' });
  }

  const newUser = {
    id: Date.now().toString(),
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role: role || 'user',
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers(users);
  
  const { passwordHash, ...userSafe } = newUser;
  res.json(userSafe);
});

app.delete('/api/users/:id', authenticate, requireAdmin, (req, res) => {
  let users = getUsers();
  const initialLen = users.length;
  users = users.filter(u => u.id !== req.params.id);

  if (users.length === initialLen) return res.status(404).json({ error: 'Usuário não encontrado' });

  saveUsers(users);
  res.json({ success: true });
});

// --- Rotas de Credenciais Seguras ---

// Salvar credenciais de uma conexão
app.post('/api/credentials/:connectionId', authenticate, (req, res) => {
  const { connectionId } = req.params;
  const { username, password, port, secure } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  try {
    saveConnectionCredentials(connectionId, req.user.id, username, password, port, secure);
    res.json({ success: true, message: 'Credenciais salvas com segurança' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar credenciais' });
  }
});

// Obter credenciais de uma conexão
app.get('/api/credentials/:connectionId', authenticate, (req, res) => {
  const { connectionId } = req.params;
  const credentials = getConnectionCredentials(connectionId, req.user.id);

  if (!credentials) {
    return res.status(404).json({ error: 'Credenciais não encontradas' });
  }

  res.json({
    username: credentials.username,
    password: credentials.password,
    port: credentials.port,
    secure: credentials.secure
  });
});

// Verificar se credenciais existem para uma conexão
app.get('/api/credentials/:connectionId/exists', authenticate, (req, res) => {
  const { connectionId } = req.params;
  const credentials = getConnectionCredentials(connectionId, req.user.id);

  res.json({
    exists: !!credentials,
    hasPort: credentials?.port !== undefined,
    hasSecure: credentials?.secure !== undefined
  });
});

// Excluir credenciais de uma conexão
app.delete('/api/credentials/:connectionId', authenticate, (req, res) => {
  const { connectionId } = req.params;
  const deleted = deleteConnectionCredentials(connectionId, req.user.id);

  if (deleted) {
    res.json({ success: true, message: 'Credenciais removidas' });
  } else {
    res.status(404).json({ error: 'Credenciais não encontradas' });
  }
});

// --- Rotas de Sistema de Arquivos ---

app.get('/api/fs/list', authenticate, (req, res) => {
  const targetPath = req.query.path || '.';
  
  try {
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Caminho não encontrado' });
    }

    const stats = fs.statSync(targetPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'O caminho não é um diretório' });
    }

    const items = fs.readdirSync(targetPath).map(name => {
      try {
        const fullPath = path.join(targetPath, name);
        const itemStats = fs.statSync(fullPath);
        return {
          id: fullPath,
          name,
          type: itemStats.isDirectory() ? 'folder' : 'file',
          size: itemStats.size,
          modifiedAt: itemStats.mtime.toISOString(),
          path: fullPath,
          parentId: targetPath,
          mimeType: itemStats.isDirectory() ? null : 'application/octet-stream'
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Rotas de Listagem de Arquivos Remotos ---

// Listar arquivos via SFTP
app.post('/api/fs/sftp/list', authenticate, async (req, res) => {
  const { host, port, username, password, path: remotePath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;

  // Se connectionId fornecido, buscar credenciais armazenadas
  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
    }
  }

  if (!host || !finalUsername || !finalPassword) {
    return res.status(400).json({ error: 'Host e credenciais são obrigatórios' });
  }

  const targetPath = remotePath || '/';

  try {
    const client = new SSHClient();
    let responded = false;

    const timeout = setTimeout(() => {
      if (!responded) {
        responded = true;
        client.end();
        res.status(408).json({ error: 'Timeout ao conectar' });
      }
    }, 15000);

    client.on('ready', () => {
      clearTimeout(timeout);
      if (responded) return;
      client.sftp((err, sftp) => {
        if (err) {
          client.end();
          return res.status(500).json({ error: `Erro SFTP: ${err.message}` });
        }

        sftp.readdir(targetPath, (err, list) => {
          client.end();

          if (err) {
            return res.status(500).json({ error: `Erro ao listar diretório: ${err.message}` });
          }

          const files = list.map(item => {
            const isDir = item.longname.startsWith('d');
            const fullPath = targetPath === '/' ? `/${item.filename}` : `${targetPath}/${item.filename}`;

            return {
              id: `sftp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: item.filename,
              type: isDir ? 'folder' : 'file',
              size: item.attrs.size || 0,
              modifiedAt: new Date(item.attrs.mtime * 1000).toISOString(),
              parentId: targetPath === '/' ? null : targetPath,
              path: targetPath,
              mimeType: isDir ? null : 'application/octet-stream'
            };
          });

          // Filtrar arquivos ocultos (opcional) e ordenar
          const filtered = files
            .filter(f => !f.name.startsWith('.'))
            .sort((a, b) => {
              if (a.type === 'folder' && b.type !== 'folder') return -1;
              if (a.type !== 'folder' && b.type === 'folder') return 1;
              return a.name.localeCompare(b.name);
            });

          res.json(filtered);
        });
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      if (responded) return;
      responded = true;
      let message = err.message;
      if (err.level === 'client-authentication') {
        message = 'Falha na autenticação';
      } else if (err.code === 'ENOTFOUND') {
        message = 'Host não encontrado';
      } else if (err.code === 'ECONNREFUSED') {
        message = 'Conexão recusada';
      }
      res.status(500).json({ error: message });
    });

    client.connect({
      host,
      port: finalPort || 22,
      username: finalUsername,
      password: finalPassword,
      readyTimeout: 15000
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper para conectar SFTP
async function connectSFTP(host, port, username, password) {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    const timeout = setTimeout(() => {
      client.end();
      reject(new Error('Timeout ao conectar'));
    }, 15000);

    client.on('ready', () => {
      clearTimeout(timeout);
      client.sftp((err, sftp) => {
        if (err) {
          client.end();
          reject(err);
        } else {
          resolve({ client, sftp });
        }
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    client.connect({
      host,
      port: port || 22,
      username,
      password,
      readyTimeout: 15000
    });
  });
}

// Download arquivo via SFTP
app.post('/api/fs/sftp/download', authenticate, async (req, res) => {
  const { host, port, username, password, path: filePath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
    }
  }

  if (!host || !finalUsername || !finalPassword || !filePath) {
    return res.status(400).json({ error: 'Host, credenciais e caminho são obrigatórios' });
  }

  try {
    const { client, sftp } = await connectSFTP(host, finalPort, finalUsername, finalPassword);
    const fileName = filePath.split('/').pop();

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const readStream = sftp.createReadStream(filePath);
    readStream.on('error', (err) => {
      client.end();
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });
    readStream.on('end', () => client.end());
    readStream.pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Criar pasta via SFTP
app.post('/api/fs/sftp/mkdir', authenticate, async (req, res) => {
  const { host, port, username, password, path: dirPath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
    }
  }

  console.log(`[SFTP mkdir] Request:`, { host, port: finalPort, connectionId, dirPath, hasCredentials: !!finalUsername && !!finalPassword });

  if (!host || !finalUsername || !finalPassword || !dirPath) {
    return res.status(400).json({ error: `Credenciais não encontradas. Reconecte ao servidor SFTP.` });
  }

  console.log(`[SFTP mkdir] Creating folder: ${dirPath} on ${host} as ${finalUsername}`);

  try {
    const { client, sftp } = await connectSFTP(host, finalPort, finalUsername, finalPassword);

    // Try with explicit permissions (0755)
    sftp.mkdir(dirPath, { mode: 0o755 }, (err) => {
      client.end();
      if (err) {
        console.error(`[SFTP mkdir] Error:`, err);
        let errorMsg = err.message;
        // Map common SFTP error codes
        if (err.code === 4 || err.message === 'Failure') {
          errorMsg = 'Servidor SFTP rejeitou a operação. Pode ser restrição do servidor de hospedagem.';
        } else if (err.code === 3) {
          errorMsg = 'Permissão negada';
        } else if (err.code === 11) {
          errorMsg = 'Pasta já existe';
        }
        return res.status(500).json({ error: errorMsg });
      }
      res.json({ success: true, message: 'Pasta criada com sucesso' });
    });
  } catch (error) {
    console.error(`[SFTP mkdir] Connection error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Deletar arquivo/pasta via SFTP
app.post('/api/fs/sftp/delete', authenticate, async (req, res) => {
  const { host, port, username, password, path: targetPath, isDir, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
    }
  }

  if (!host || !finalUsername || !finalPassword || !targetPath) {
    return res.status(400).json({ error: 'Host, credenciais e caminho são obrigatórios' });
  }

  try {
    const { client, sftp } = await connectSFTP(host, finalPort, finalUsername, finalPassword);

    const deleteItem = isDir ? sftp.rmdir.bind(sftp) : sftp.unlink.bind(sftp);

    deleteItem(targetPath, (err) => {
      client.end();
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, message: 'Item excluído com sucesso' });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Renomear arquivo/pasta via SFTP
app.post('/api/fs/sftp/rename', authenticate, async (req, res) => {
  const { host, port, username, password, oldPath, newPath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
    }
  }

  if (!host || !finalUsername || !finalPassword || !oldPath || !newPath) {
    return res.status(400).json({ error: 'Host, credenciais e caminhos são obrigatórios' });
  }

  try {
    const { client, sftp } = await connectSFTP(host, finalPort, finalUsername, finalPassword);

    sftp.rename(oldPath, newPath, (err) => {
      client.end();
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, message: 'Item renomeado com sucesso' });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Copy file via SFTP (same server)
app.post('/api/fs/sftp/copy', authenticate, async (req, res) => {
  const { host, port, username, password, srcPath, dstPath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
    }
  }

  if (!host || !finalUsername || !finalPassword || !srcPath || !dstPath) {
    return res.status(400).json({ error: 'Host, credenciais e caminhos são obrigatórios' });
  }

  try {
    const { client, sftp } = await connectSFTP(host, finalPort, finalUsername, finalPassword);

    // Read from source and write to destination
    const readStream = sftp.createReadStream(srcPath);
    const writeStream = sftp.createWriteStream(dstPath);

    readStream.pipe(writeStream);

    writeStream.on('close', () => {
      client.end();
      res.json({ success: true, message: 'Arquivo copiado com sucesso' });
    });

    writeStream.on('error', (err) => {
      client.end();
      res.status(500).json({ error: err.message });
    });

    readStream.on('error', (err) => {
      client.end();
      res.status(500).json({ error: err.message });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obter quota de armazenamento via SFTP
app.post('/api/fs/sftp/quota', authenticate, async (req, res) => {
  const { host, port, username, password, path: remotePath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
    }
  }

  if (!host || !finalUsername || !finalPassword) {
    return res.status(400).json({ error: 'Credenciais não encontradas' });
  }

  try {
    const { client, sftp } = await connectSFTP(host, finalPort, finalUsername, finalPassword);
    const targetPath = remotePath || '/';

    sftp.statvfs(targetPath, (err, stats) => {
      client.end();
      if (err || !stats) {
        // Fallback: return unknown if statvfs not supported
        return res.json({ used: null, total: null, available: null });
      }

      try {
        const blockSize = stats.bsize || stats.f_bsize || 1;
        const totalBytes = (stats.blocks || stats.f_blocks || 0) * blockSize;
        const availableBytes = (stats.bavail || stats.f_bavail || 0) * blockSize;
        const usedBytes = totalBytes - availableBytes;

        res.json({
          used: Math.round(usedBytes / (1024 * 1024 * 1024) * 100) / 100,
          total: Math.round(totalBytes / (1024 * 1024 * 1024) * 100) / 100,
          available: Math.round(availableBytes / (1024 * 1024 * 1024) * 100) / 100
        });
      } catch (e) {
        res.json({ used: null, total: null, available: null });
      }
    });
  } catch (error) {
    console.error('SFTP quota error:', error);
    res.json({ used: null, total: null, available: null });
  }
});

// Obter quota de armazenamento via rclone (cloud providers)
app.get('/api/rclone/quota/:remote', authenticate, async (req, res) => {
  const { remote } = req.params;

  try {
    const result = await rcloneRCD('operations/about', 'POST', { fs: `${remote}:` });

    res.json({
      used: result.used ? Math.round(result.used / (1024 * 1024 * 1024) * 100) / 100 : null,
      total: result.total ? Math.round(result.total / (1024 * 1024 * 1024) * 100) / 100 : null,
      available: result.free ? Math.round(result.free / (1024 * 1024 * 1024) * 100) / 100 : null,
      trashed: result.trashed ? Math.round(result.trashed / (1024 * 1024 * 1024) * 100) / 100 : null
    });
  } catch (error) {
    // Return nulls if quota not available
    res.json({ used: null, total: null, available: null });
  }
});

// Upload arquivo via SFTP
app.post('/api/fs/sftp/upload', authenticate, upload.single('file'), async (req, res) => {
  const { host, port, connectionId, remotePath } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  let finalUsername, finalPassword, finalPort;

  if (connectionId) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port || 22;
    }
  }

  if (!host || !finalUsername || !finalPassword) {
    // Clean up temp file
    fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'Credenciais não encontradas' });
  }

  const destinationPath = remotePath ? `${remotePath}/${file.originalname}` : `/${file.originalname}`;
  console.log(`[SFTP Upload] Uploading ${file.originalname} to ${destinationPath} on ${host}`);

  try {
    const { client, sftp } = await connectSFTP(host, finalPort, finalUsername, finalPassword);

    const readStream = fs.createReadStream(file.path);
    const writeStream = sftp.createWriteStream(destinationPath);

    writeStream.on('close', () => {
      client.end();
      // Clean up temp file
      fs.unlinkSync(file.path);
      console.log(`[SFTP Upload] Success: ${file.originalname}`);
      res.json({
        success: true,
        message: 'Arquivo enviado com sucesso',
        file: {
          name: file.originalname,
          size: file.size,
          path: destinationPath
        }
      });
    });

    writeStream.on('error', (err) => {
      client.end();
      fs.unlinkSync(file.path);
      console.error(`[SFTP Upload] Error:`, err);
      res.status(500).json({ error: err.message });
    });

    readStream.pipe(writeStream);
  } catch (error) {
    fs.unlinkSync(file.path);
    console.error(`[SFTP Upload] Connection error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Upload arquivo via rclone (cloud providers)
app.post('/api/rclone/upload', authenticate, upload.single('file'), async (req, res) => {
  const { remote, remotePath } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  if (!remote) {
    fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'Remote é obrigatório' });
  }

  const destinationPath = remotePath ? `${remotePath}/${file.originalname}` : file.originalname;
  console.log(`[Rclone Upload] Uploading ${file.originalname} to ${remote}:${destinationPath}`);

  try {
    // Use rclone copyto command
    const rcloneProcess = spawn('rclone', [
      'copyto',
      file.path,
      `${remote}:${destinationPath}`,
      '--progress'
    ]);

    let stderr = '';

    rcloneProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    rcloneProcess.on('close', (code) => {
      // Clean up temp file
      fs.unlinkSync(file.path);

      if (code === 0) {
        console.log(`[Rclone Upload] Success: ${file.originalname}`);
        res.json({
          success: true,
          message: 'Arquivo enviado com sucesso',
          file: {
            name: file.originalname,
            size: file.size,
            path: destinationPath
          }
        });
      } else {
        console.error(`[Rclone Upload] Error:`, stderr);
        res.status(500).json({ error: stderr || 'Erro ao enviar arquivo' });
      }
    });

    rcloneProcess.on('error', (err) => {
      fs.unlinkSync(file.path);
      console.error(`[Rclone Upload] Process error:`, err);
      res.status(500).json({ error: err.message });
    });
  } catch (error) {
    fs.unlinkSync(file.path);
    console.error(`[Rclone Upload] Error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Listar arquivos via FTP/FTPS
app.post('/api/fs/ftp/list', authenticate, async (req, res) => {
  const { host, port, username, password, secure, path: remotePath, connectionId } = req.body;

  if (!host) {
    return res.status(400).json({ error: 'Host é obrigatório' });
  }

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;
  let finalSecure = secure;

  // Se connectionId fornecido, buscar credenciais armazenadas
  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
      finalSecure = stored.secure !== undefined ? stored.secure : secure;
    }
  }

  const targetPath = remotePath || '/';
  const client = new ftp.Client();
  client.ftp.timeout = 15000;

  try {
    const defaultPort = finalSecure ? 990 : 21;

    await client.access({
      host,
      port: finalPort || defaultPort,
      user: finalUsername || 'anonymous',
      password: finalPassword || 'anonymous@',
      secure: finalSecure || false,
      secureOptions: finalSecure ? { rejectUnauthorized: false } : undefined
    });

    const list = await client.list(targetPath);
    client.close();

    const files = list.map(item => {
      const fullPath = targetPath === '/' ? `/${item.name}` : `${targetPath}/${item.name}`;

      return {
        id: `ftp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: item.name,
        type: item.isDirectory ? 'folder' : 'file',
        size: item.size || 0,
        modifiedAt: item.modifiedAt ? item.modifiedAt.toISOString() : new Date().toISOString(),
        parentId: targetPath === '/' ? null : targetPath,
        path: targetPath,
        mimeType: item.isDirectory ? null : 'application/octet-stream'
      };
    });

    // Filtrar e ordenar
    const filtered = files
      .filter(f => !f.name.startsWith('.'))
      .sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });

    res.json(filtered);

  } catch (err) {
    client.close();
    let message = err.message;
    if (err.code === 530) {
      message = 'Falha na autenticação';
    } else if (err.code === 'ENOTFOUND') {
      message = 'Host não encontrado';
    } else if (err.code === 'ECONNREFUSED') {
      message = 'Conexão recusada';
    }
    res.status(500).json({ error: message });
  }
});

// Helper para conectar FTP
async function connectFTP(host, port, username, password, secure = false) {
  const client = new ftp.Client();
  client.ftp.timeout = 15000;

  await client.access({
    host,
    port: port || (secure ? 990 : 21),
    user: username,
    password,
    secure: secure ? 'implicit' : false
  });

  return client;
}

// Download arquivo via FTP
app.post('/api/fs/ftp/download', authenticate, async (req, res) => {
  const { host, port, username, password, secure, path: filePath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;
  let finalSecure = secure;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
      finalSecure = stored.secure !== undefined ? stored.secure : secure;
    }
  }

  if (!host || !finalUsername || !finalPassword || !filePath) {
    return res.status(400).json({ error: 'Host, credenciais e caminho são obrigatórios' });
  }

  const client = new ftp.Client();
  try {
    await client.access({
      host,
      port: finalPort || (finalSecure ? 990 : 21),
      user: finalUsername,
      password: finalPassword,
      secure: finalSecure ? 'implicit' : false
    });

    const fileName = filePath.split('/').pop();
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    await client.downloadTo(res, filePath);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  } finally {
    client.close();
  }
});

// Upload arquivo via FTP
app.post('/api/fs/ftp/upload', authenticate, upload.single('file'), async (req, res) => {
  const { host, port, secure, connectionId, remotePath } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  let finalUsername, finalPassword, finalPort, finalSecure;

  if (connectionId) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port || 21;
      finalSecure = stored.secure;
    }
  }

  if (!host || !finalUsername || !finalPassword) {
    fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'Credenciais não encontradas' });
  }

  const destinationPath = remotePath ? `${remotePath}/${file.originalname}` : `/${file.originalname}`;
  const client = new ftp.Client();

  try {
    await client.access({
      host,
      port: finalPort || (finalSecure ? 990 : 21),
      user: finalUsername,
      password: finalPassword,
      secure: finalSecure ? 'implicit' : false
    });

    await client.uploadFrom(file.path, destinationPath);
    fs.unlinkSync(file.path);

    res.json({
      success: true,
      message: 'Arquivo enviado com sucesso',
      file: { name: file.originalname, size: file.size, path: destinationPath }
    });
  } catch (error) {
    fs.unlinkSync(file.path);
    res.status(500).json({ error: error.message });
  } finally {
    client.close();
  }
});

// Criar pasta via FTP
app.post('/api/fs/ftp/mkdir', authenticate, async (req, res) => {
  const { host, port, username, password, secure, path: dirPath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;
  let finalSecure = secure;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
      finalSecure = stored.secure !== undefined ? stored.secure : secure;
    }
  }

  if (!host || !finalUsername || !finalPassword || !dirPath) {
    return res.status(400).json({ error: 'Host, credenciais e caminho são obrigatórios' });
  }

  const client = new ftp.Client();
  try {
    await client.access({
      host,
      port: finalPort || (finalSecure ? 990 : 21),
      user: finalUsername,
      password: finalPassword,
      secure: finalSecure ? 'implicit' : false
    });

    await client.ensureDir(dirPath);
    res.json({ success: true, message: 'Pasta criada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.close();
  }
});

// Deletar arquivo/pasta via FTP
app.post('/api/fs/ftp/delete', authenticate, async (req, res) => {
  const { host, port, username, password, secure, path: targetPath, isDir, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;
  let finalSecure = secure;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
      finalSecure = stored.secure !== undefined ? stored.secure : secure;
    }
  }

  if (!host || !finalUsername || !finalPassword || !targetPath) {
    return res.status(400).json({ error: 'Host, credenciais e caminho são obrigatórios' });
  }

  const client = new ftp.Client();
  try {
    await client.access({
      host,
      port: finalPort || (finalSecure ? 990 : 21),
      user: finalUsername,
      password: finalPassword,
      secure: finalSecure ? 'implicit' : false
    });

    if (isDir) {
      await client.removeDir(targetPath);
    } else {
      await client.remove(targetPath);
    }
    res.json({ success: true, message: 'Item excluído com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.close();
  }
});

// Renomear arquivo/pasta via FTP
app.post('/api/fs/ftp/rename', authenticate, async (req, res) => {
  const { host, port, username, password, secure, oldPath, newPath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;
  let finalPort = port;
  let finalSecure = secure;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
      finalPort = stored.port || port;
      finalSecure = stored.secure !== undefined ? stored.secure : secure;
    }
  }

  if (!host || !finalUsername || !finalPassword || !oldPath || !newPath) {
    return res.status(400).json({ error: 'Host, credenciais e caminhos são obrigatórios' });
  }

  const client = new ftp.Client();
  try {
    await client.access({
      host,
      port: finalPort || (finalSecure ? 990 : 21),
      user: finalUsername,
      password: finalPassword,
      secure: finalSecure ? 'implicit' : false
    });

    await client.rename(oldPath, newPath);
    res.json({ success: true, message: 'Item renomeado com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.close();
  }
});

// Listar arquivos via S3
app.post('/api/fs/s3/list', authenticate, async (req, res) => {
  const { host, username, password, bucket, prefix, region, connectionId } = req.body;

  let accessKeyId = username;
  let secretAccessKey = password;

  // Se connectionId fornecido, buscar credenciais armazenadas
  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      accessKeyId = stored.username;
      secretAccessKey = stored.password;
    }
  }

  if (!accessKeyId || !secretAccessKey) {
    return res.status(400).json({ error: 'Access Key e Secret Key são obrigatórios' });
  }

  try {
    const config = {
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      region: region || 'us-east-1'
    };

    // Se endpoint customizado (MinIO, etc)
    if (host && !host.includes('amazonaws.com')) {
      config.endpoint = host.startsWith('http') ? host : `https://${host}`;
      config.forcePathStyle = true;
    }

    const client = new S3Client(config);

    // Se não há bucket especificado, listar buckets
    if (!bucket) {
      const command = new ListBucketsCommand({});
      const response = await client.send(command);

      const buckets = (response.Buckets || []).map(b => ({
        id: `s3-bucket-${b.Name}`,
        name: b.Name,
        type: 'folder',
        size: 0,
        modifiedAt: b.CreationDate ? b.CreationDate.toISOString() : new Date().toISOString(),
        parentId: null,
        path: '/',
        mimeType: null,
        isBucket: true
      }));

      return res.json(buckets);
    }

    // Listar objetos no bucket
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || '',
      Delimiter: '/'
    });

    const response = await client.send(command);

    const files = [];

    // Adicionar "pastas" (CommonPrefixes)
    if (response.CommonPrefixes) {
      for (const p of response.CommonPrefixes) {
        const folderName = p.Prefix.replace(prefix || '', '').replace(/\/$/, '');
        if (folderName) {
          files.push({
            id: `s3-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: folderName,
            type: 'folder',
            size: 0,
            modifiedAt: new Date().toISOString(),
            parentId: prefix || '/',
            path: prefix || '/',
            mimeType: null,
            s3Key: p.Prefix
          });
        }
      }
    }

    // Adicionar arquivos
    if (response.Contents) {
      for (const obj of response.Contents) {
        const fileName = obj.Key.replace(prefix || '', '');
        // Ignorar o próprio prefixo
        if (fileName && fileName !== '/') {
          files.push({
            id: `s3-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: fileName,
            type: 'file',
            size: obj.Size || 0,
            modifiedAt: obj.LastModified ? obj.LastModified.toISOString() : new Date().toISOString(),
            parentId: prefix || '/',
            path: prefix || '/',
            mimeType: 'application/octet-stream',
            s3Key: obj.Key
          });
        }
      }
    }

    // Ordenar: pastas primeiro, depois por nome
    files.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });

    res.json(files);

  } catch (err) {
    let message = err.message;
    if (err.name === 'InvalidAccessKeyId') {
      message = 'Access Key ID inválido';
    } else if (err.name === 'SignatureDoesNotMatch') {
      message = 'Secret Access Key inválido';
    } else if (err.name === 'NoSuchBucket') {
      message = 'Bucket não encontrado';
    } else if (err.name === 'AccessDenied') {
      message = 'Acesso negado ao bucket';
    }
    res.status(500).json({ error: message });
  }
});

// Helper para criar cliente S3
function createS3Client(host, accessKeyId, secretAccessKey, region) {
  const config = {
    credentials: { accessKeyId, secretAccessKey },
    region: region || 'us-east-1'
  };
  if (host && !host.includes('amazonaws.com')) {
    config.endpoint = host.startsWith('http') ? host : `https://${host}`;
    config.forcePathStyle = true;
  }
  return new S3Client(config);
}

// Download arquivo via S3
app.post('/api/fs/s3/download', authenticate, async (req, res) => {
  const { host, username, password, bucket, key, region, connectionId } = req.body;

  let accessKeyId = username;
  let secretAccessKey = password;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      accessKeyId = stored.username;
      secretAccessKey = stored.password;
    }
  }

  if (!accessKeyId || !secretAccessKey || !bucket || !key) {
    return res.status(400).json({ error: 'Credenciais, bucket e key são obrigatórios' });
  }

  try {
    const client = createS3Client(host, accessKeyId, secretAccessKey, region);
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await client.send(command);

    const fileName = key.split('/').pop();
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', response.ContentType || 'application/octet-stream');
    if (response.ContentLength) {
      res.setHeader('Content-Length', response.ContentLength);
    }

    response.Body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload arquivo via S3
app.post('/api/fs/s3/upload', authenticate, upload.single('file'), async (req, res) => {
  const { host, username, password, bucket, prefix, region, connectionId } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  let accessKeyId = username;
  let secretAccessKey = password;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      accessKeyId = stored.username;
      secretAccessKey = stored.password;
    }
  }

  if (!accessKeyId || !secretAccessKey || !bucket) {
    fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'Credenciais e bucket são obrigatórios' });
  }

  try {
    const client = createS3Client(host, accessKeyId, secretAccessKey, region);
    const key = prefix ? `${prefix}${file.originalname}` : file.originalname;
    const fileContent = fs.readFileSync(file.path);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fileContent
    });

    await client.send(command);
    fs.unlinkSync(file.path);
    res.json({ success: true, message: 'Arquivo enviado com sucesso', key });
  } catch (err) {
    fs.unlinkSync(file.path);
    res.status(500).json({ error: err.message });
  }
});

// Criar pasta via S3 (cria objeto vazio com /)
app.post('/api/fs/s3/mkdir', authenticate, async (req, res) => {
  const { host, username, password, bucket, path: folderPath, region, connectionId } = req.body;

  let accessKeyId = username;
  let secretAccessKey = password;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      accessKeyId = stored.username;
      secretAccessKey = stored.password;
    }
  }

  if (!accessKeyId || !secretAccessKey || !bucket || !folderPath) {
    return res.status(400).json({ error: 'Credenciais, bucket e caminho são obrigatórios' });
  }

  try {
    const client = createS3Client(host, accessKeyId, secretAccessKey, region);
    const key = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: ''
    });

    await client.send(command);
    res.json({ success: true, message: 'Pasta criada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletar arquivo/pasta via S3
app.post('/api/fs/s3/delete', authenticate, async (req, res) => {
  const { host, username, password, bucket, keys, region, connectionId } = req.body;

  let accessKeyId = username;
  let secretAccessKey = password;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      accessKeyId = stored.username;
      secretAccessKey = stored.password;
    }
  }

  if (!accessKeyId || !secretAccessKey || !bucket || !keys || !Array.isArray(keys)) {
    return res.status(400).json({ error: 'Credenciais, bucket e keys são obrigatórios' });
  }

  try {
    const client = createS3Client(host, accessKeyId, secretAccessKey, region);
    const command = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map(k => ({ Key: k })) }
    });

    await client.send(command);
    res.json({ success: true, message: 'Itens excluídos com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Renomear arquivo via S3 (copy + delete)
app.post('/api/fs/s3/rename', authenticate, async (req, res) => {
  const { host, username, password, bucket, oldKey, newKey, region, connectionId } = req.body;

  let accessKeyId = username;
  let secretAccessKey = password;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      accessKeyId = stored.username;
      secretAccessKey = stored.password;
    }
  }

  if (!accessKeyId || !secretAccessKey || !bucket || !oldKey || !newKey) {
    return res.status(400).json({ error: 'Credenciais, bucket e keys são obrigatórios' });
  }

  try {
    const client = createS3Client(host, accessKeyId, secretAccessKey, region);

    // Copy to new location
    const copyCommand = new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${oldKey}`,
      Key: newKey
    });
    await client.send(copyCommand);

    // Delete old object
    const deleteCommand = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: [{ Key: oldKey }] }
    });
    await client.send(deleteCommand);

    res.json({ success: true, message: 'Arquivo renomeado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Copy file in S3 (same bucket)
app.post('/api/fs/s3/copy', authenticate, async (req, res) => {
  const { host, username, password, bucket, srcKey, dstKey, region, connectionId } = req.body;

  let accessKeyId = username;
  let secretAccessKey = password;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      accessKeyId = stored.username;
      secretAccessKey = stored.password;
    }
  }

  if (!accessKeyId || !secretAccessKey || !bucket || !srcKey || !dstKey) {
    return res.status(400).json({ error: 'Credenciais, bucket e keys são obrigatórios' });
  }

  try {
    const client = createS3Client(host, accessKeyId, secretAccessKey, region);

    const copyCommand = new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${srcKey}`,
      Key: dstKey
    });
    await client.send(copyCommand);

    res.json({ success: true, message: 'Arquivo copiado com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar arquivos via SMB
app.post('/api/fs/smb/list', authenticate, async (req, res) => {
  const { host, username, password, domain, port, path: smbPath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;

  // Se connectionId fornecido, buscar credenciais armazenadas
  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
    }
  }

  if (!host) {
    return res.status(400).json({ error: 'Host SMB é obrigatório' });
  }

  // Extrair host e share do path
  let smbHost = host;
  let share = '';

  if (host.includes('/')) {
    const parts = host.split('/');
    smbHost = parts[0];
    share = parts[1] || '';
  } else if (host.includes('\\')) {
    const parts = host.split('\\');
    smbHost = parts[0];
    share = parts[1] || '';
  }

  if (!share) {
    return res.status(400).json({
      error: 'Share SMB é obrigatório',
      details: 'O formato deve ser: host/share (ex: 192.168.1.100/documentos)'
    });
  }

  if (!finalUsername || !finalPassword) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios para SMB' });
  }

  try {
    const smb2Client = new SMB2({
      share: `\\\\${smbHost}\\${share}`,
      domain: domain || '',
      username: finalUsername,
      password: finalPassword,
      port: port || 445,
      autoCloseTimeout: 10000
    });

    const targetPath = smbPath || '';

    // Listar diretório
    const list = await new Promise((resolve, reject) => {
      smb2Client.readdir(targetPath, (err, files) => {
        if (err) {
          reject(err);
        } else {
          resolve(files);
        }
      });
    });

    // Obter informações detalhadas de cada arquivo
    const filesWithStats = await Promise.all(
      list.map(async (fileName) => {
        try {
          const filePath = targetPath ? `${targetPath}\\${fileName}` : fileName;
          const stats = await new Promise((resolve, reject) => {
            smb2Client.stat(filePath, (err, stats) => {
              if (err) {
                // Se não conseguir stat, assume arquivo
                resolve({ isDirectory: () => false, size: 0, mtime: new Date() });
              } else {
                resolve(stats);
              }
            });
          });

          return {
            id: `smb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: fileName,
            type: stats.isDirectory() ? 'folder' : 'file',
            size: stats.size || 0,
            modifiedAt: stats.mtime ? stats.mtime.toISOString() : new Date().toISOString(),
            parentId: targetPath || '/',
            path: targetPath || '/',
            mimeType: stats.isDirectory() ? null : 'application/octet-stream'
          };
        } catch (e) {
          // Fallback se stat falhar
          return {
            id: `smb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: fileName,
            type: 'file',
            size: 0,
            modifiedAt: new Date().toISOString(),
            parentId: targetPath || '/',
            path: targetPath || '/',
            mimeType: 'application/octet-stream'
          };
        }
      })
    );

    // Fechar conexão
    smb2Client.close();

    // Filtrar e ordenar
    const filtered = filesWithStats
      .filter(f => !f.name.startsWith('.'))
      .sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });

    res.json(filtered);

  } catch (err) {
    let message = err.message;
    if (err.code === 'STATUS_LOGON_FAILURE') {
      message = 'Falha na autenticação: usuário ou senha incorretos';
    } else if (err.code === 'STATUS_BAD_NETWORK_NAME') {
      message = 'Share não encontrado';
    } else if (err.code === 'ENOTFOUND') {
      message = 'Host não encontrado';
    } else if (err.code === 'ECONNREFUSED') {
      message = 'Conexão recusada - verifique host e porta';
    } else if (err.code === 'ETIMEDOUT') {
      message = 'Timeout de conexão';
    }
    res.status(500).json({ error: message });
  }
});

// Helper para criar cliente SMB
function createSMBClient(host, share, username, password, domain) {
  return new SMB2({
    share: `\\\\${host}\\${share}`,
    domain: domain || '',
    username,
    password,
    autoCloseTimeout: 30000
  });
}

// Download arquivo via SMB
app.post('/api/fs/smb/download', authenticate, async (req, res) => {
  const { host, username, password, domain, path: filePath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
    }
  }

  // Parse host/share
  let smbHost = host;
  let share = '';
  if (host && host.includes('/')) {
    const parts = host.split('/');
    smbHost = parts[0];
    share = parts[1] || '';
  }

  if (!smbHost || !share || !finalUsername || !finalPassword || !filePath) {
    return res.status(400).json({ error: 'Host, share, credenciais e caminho são obrigatórios' });
  }

  const smb2Client = createSMBClient(smbHost, share, finalUsername, finalPassword, domain);

  try {
    const fileName = filePath.split(/[/\\]/).pop();
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    smb2Client.readFile(filePath, (err, data) => {
      smb2Client.close();
      if (err) {
        if (!res.headersSent) {
          return res.status(500).json({ error: err.message });
        }
      }
      res.send(data);
    });
  } catch (error) {
    smb2Client.close();
    res.status(500).json({ error: error.message });
  }
});

// Upload arquivo via SMB
app.post('/api/fs/smb/upload', authenticate, upload.single('file'), async (req, res) => {
  const { host, domain, connectionId, remotePath } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  let finalUsername, finalPassword;

  if (connectionId) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
    }
  }

  // Parse host/share
  let smbHost = host;
  let share = '';
  if (host && host.includes('/')) {
    const parts = host.split('/');
    smbHost = parts[0];
    share = parts[1] || '';
  }

  if (!smbHost || !share || !finalUsername || !finalPassword) {
    fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'Credenciais não encontradas' });
  }

  const destinationPath = remotePath ? `${remotePath}\\${file.originalname}` : file.originalname;
  const smb2Client = createSMBClient(smbHost, share, finalUsername, finalPassword, domain);

  try {
    const fileData = fs.readFileSync(file.path);
    smb2Client.writeFile(destinationPath, fileData, (err) => {
      smb2Client.close();
      fs.unlinkSync(file.path);
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({
        success: true,
        message: 'Arquivo enviado com sucesso',
        file: { name: file.originalname, size: file.size, path: destinationPath }
      });
    });
  } catch (error) {
    fs.unlinkSync(file.path);
    smb2Client.close();
    res.status(500).json({ error: error.message });
  }
});

// Criar pasta via SMB
app.post('/api/fs/smb/mkdir', authenticate, async (req, res) => {
  const { host, username, password, domain, path: dirPath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
    }
  }

  let smbHost = host;
  let share = '';
  if (host && host.includes('/')) {
    const parts = host.split('/');
    smbHost = parts[0];
    share = parts[1] || '';
  }

  if (!smbHost || !share || !finalUsername || !finalPassword || !dirPath) {
    return res.status(400).json({ error: 'Host, share, credenciais e caminho são obrigatórios' });
  }

  const smb2Client = createSMBClient(smbHost, share, finalUsername, finalPassword, domain);

  smb2Client.mkdir(dirPath, (err) => {
    smb2Client.close();
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: 'Pasta criada com sucesso' });
  });
});

// Deletar arquivo/pasta via SMB
app.post('/api/fs/smb/delete', authenticate, async (req, res) => {
  const { host, username, password, domain, path: targetPath, isDir, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
    }
  }

  let smbHost = host;
  let share = '';
  if (host && host.includes('/')) {
    const parts = host.split('/');
    smbHost = parts[0];
    share = parts[1] || '';
  }

  if (!smbHost || !share || !finalUsername || !finalPassword || !targetPath) {
    return res.status(400).json({ error: 'Host, share, credenciais e caminho são obrigatórios' });
  }

  const smb2Client = createSMBClient(smbHost, share, finalUsername, finalPassword, domain);

  const deleteFunc = isDir ? smb2Client.rmdir.bind(smb2Client) : smb2Client.unlink.bind(smb2Client);

  deleteFunc(targetPath, (err) => {
    smb2Client.close();
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: 'Item excluído com sucesso' });
  });
});

// Renomear arquivo/pasta via SMB
app.post('/api/fs/smb/rename', authenticate, async (req, res) => {
  const { host, username, password, domain, oldPath, newPath, connectionId } = req.body;

  let finalUsername = username;
  let finalPassword = password;

  if (connectionId && (!username || !password)) {
    const stored = getConnectionCredentials(connectionId, req.user.id);
    if (stored) {
      finalUsername = stored.username;
      finalPassword = stored.password;
    }
  }

  let smbHost = host;
  let share = '';
  if (host && host.includes('/')) {
    const parts = host.split('/');
    smbHost = parts[0];
    share = parts[1] || '';
  }

  if (!smbHost || !share || !finalUsername || !finalPassword || !oldPath || !newPath) {
    return res.status(400).json({ error: 'Host, share, credenciais e caminhos são obrigatórios' });
  }

  const smb2Client = createSMBClient(smbHost, share, finalUsername, finalPassword, domain);

  smb2Client.rename(oldPath, newPath, (err) => {
    smb2Client.close();
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, message: 'Item renomeado com sucesso' });
  });
});

// Listar arquivos via NFS (sistema de arquivos montado)
app.post('/api/fs/nfs/list', authenticate, async (req, res) => {
  const { host, path: nfsPath, mountPoint } = req.body;

  if (!host) {
    return res.status(400).json({ error: 'Host:caminho NFS é obrigatório' });
  }

  // Validar formato host:/path
  if (!host.includes(':')) {
    return res.status(400).json({
      error: 'Formato inválido. Use: host:/caminho/export',
      suggestion: 'Exemplo: 192.168.1.100:/exports/dados'
    });
  }

  const [nfsHost, exportPath] = host.split(':');

  // Se mountPoint fornecido, listar arquivos do ponto de montagem
  if (mountPoint && fs.existsSync(mountPoint)) {
    try {
      const targetPath = nfsPath ? path.join(mountPoint, nfsPath) : mountPoint;

      if (!fs.existsSync(targetPath)) {
        return res.status(404).json({ error: 'Caminho não encontrado no ponto de montagem' });
      }

      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'O caminho não é um diretório' });
      }

      const items = fs.readdirSync(targetPath).map(name => {
        try {
          const fullPath = path.join(targetPath, name);
          const itemStats = fs.statSync(fullPath);
          return {
            id: `nfs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name,
            type: itemStats.isDirectory() ? 'folder' : 'file',
            size: itemStats.size,
            modifiedAt: itemStats.mtime.toISOString(),
            path: nfsPath || '/',
            parentId: nfsPath || null,
            mimeType: itemStats.isDirectory() ? null : 'application/octet-stream'
          };
        } catch (e) {
          return null;
        }
      }).filter(Boolean);

      // Filtrar e ordenar
      const filtered = items
        .filter(f => !f.name.startsWith('.'))
        .sort((a, b) => {
          if (a.type === 'folder' && b.type !== 'folder') return -1;
          if (a.type !== 'folder' && b.type === 'folder') return 1;
          return a.name.localeCompare(b.name);
        });

      return res.json(filtered);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Se não há mountPoint, retornar instrução de montagem
  return res.status(501).json({
    error: 'NFS não montado',
    details: 'Para acessar NFS, é necessário montar o export primeiro',
    suggestion: `Monte com: sudo mount -t nfs ${host} /mnt/nfs_mount`,
    mountCommand: `mount -t nfs ${host} /mnt/nfs_mount`
  });
});

// Download arquivo via NFS (sistema montado)
app.post('/api/fs/nfs/download', authenticate, async (req, res) => {
  const { mountPoint, path: filePath } = req.body;

  if (!mountPoint || !filePath) {
    return res.status(400).json({ error: 'MountPoint e caminho são obrigatórios' });
  }

  const fullPath = path.join(mountPoint, filePath);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado' });
  }

  const fileName = path.basename(fullPath);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Type', 'application/octet-stream');

  const readStream = fs.createReadStream(fullPath);
  readStream.pipe(res);
});

// Upload arquivo via NFS (sistema montado)
app.post('/api/fs/nfs/upload', authenticate, upload.single('file'), async (req, res) => {
  const { mountPoint, remotePath } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  if (!mountPoint) {
    fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'MountPoint é obrigatório' });
  }

  const destDir = remotePath ? path.join(mountPoint, remotePath) : mountPoint;
  const destinationPath = path.join(destDir, file.originalname);

  try {
    fs.copyFileSync(file.path, destinationPath);
    fs.unlinkSync(file.path);
    res.json({
      success: true,
      message: 'Arquivo enviado com sucesso',
      file: { name: file.originalname, size: file.size, path: destinationPath }
    });
  } catch (error) {
    fs.unlinkSync(file.path);
    res.status(500).json({ error: error.message });
  }
});

// Criar pasta via NFS (sistema montado)
app.post('/api/fs/nfs/mkdir', authenticate, async (req, res) => {
  const { mountPoint, path: dirPath } = req.body;

  if (!mountPoint || !dirPath) {
    return res.status(400).json({ error: 'MountPoint e caminho são obrigatórios' });
  }

  const fullPath = path.join(mountPoint, dirPath);

  try {
    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ success: true, message: 'Pasta criada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deletar arquivo/pasta via NFS (sistema montado)
app.post('/api/fs/nfs/delete', authenticate, async (req, res) => {
  const { mountPoint, path: targetPath, isDir } = req.body;

  if (!mountPoint || !targetPath) {
    return res.status(400).json({ error: 'MountPoint e caminho são obrigatórios' });
  }

  const fullPath = path.join(mountPoint, targetPath);

  try {
    if (isDir) {
      fs.rmdirSync(fullPath, { recursive: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    res.json({ success: true, message: 'Item excluído com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Renomear arquivo/pasta via NFS (sistema montado)
app.post('/api/fs/nfs/rename', authenticate, async (req, res) => {
  const { mountPoint, oldPath, newPath } = req.body;

  if (!mountPoint || !oldPath || !newPath) {
    return res.status(400).json({ error: 'MountPoint e caminhos são obrigatórios' });
  }

  const fullOldPath = path.join(mountPoint, oldPath);
  const fullNewPath = path.join(mountPoint, newPath);

  try {
    fs.renameSync(fullOldPath, fullNewPath);
    res.json({ success: true, message: 'Item renomeado com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Rotas de Teste de Conexão ---

// Função para testar SFTP
async function testSFTP(host, port, username, password) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const client = new SSHClient();

    const timeout = setTimeout(() => {
      client.end();
      resolve({ success: false, message: 'Timeout ao conectar (10s)', latency: 10000 });
    }, 10000);

    client.on('ready', () => {
      clearTimeout(timeout);
      const latency = Date.now() - startTime;
      client.sftp((err, sftp) => {
        if (err) {
          client.end();
          resolve({ success: false, message: `Erro SFTP: ${err.message}`, latency });
        } else {
          sftp.readdir('/', (err, list) => {
            client.end();
            if (err) {
              resolve({ success: true, message: 'Conectado (sem permissão para listar /)', latency });
            } else {
              resolve({ success: true, message: `Conectado! ${list.length} itens na raiz`, latency });
            }
          });
        }
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      const latency = Date.now() - startTime;
      let message = err.message;
      if (err.level === 'client-authentication') {
        message = 'Falha na autenticação: usuário ou senha incorretos';
      } else if (err.code === 'ENOTFOUND') {
        message = 'Host não encontrado';
      } else if (err.code === 'ECONNREFUSED') {
        message = 'Conexão recusada - verifique host e porta';
      } else if (err.code === 'ETIMEDOUT') {
        message = 'Timeout de conexão';
      }
      resolve({ success: false, message, latency });
    });

    client.connect({
      host,
      port: port || 22,
      username,
      password,
      readyTimeout: 10000
    });
  });
}

// Função para testar FTP/FTPS
async function testFTP(host, port, username, password, secure = false) {
  const startTime = Date.now();
  const client = new ftp.Client();
  client.ftp.timeout = 10000;

  // Default ports: FTP=21, FTPS=990
  const defaultPort = secure ? 990 : 21;

  try {
    await client.access({
      host,
      port: port || defaultPort,
      user: username || 'anonymous',
      password: password || 'anonymous@',
      secure: secure,
      secureOptions: secure ? { rejectUnauthorized: false } : undefined
    });

    const list = await client.list();
    const latency = Date.now() - startTime;
    client.close();

    const protocol = secure ? 'FTPS' : 'FTP';
    return { success: true, message: `Conectado via ${protocol}! ${list.length} itens na raiz`, latency };
  } catch (err) {
    const latency = Date.now() - startTime;
    let message = err.message;
    if (err.code === 530) {
      message = 'Falha na autenticação: usuário ou senha incorretos';
    } else if (err.code === 'ENOTFOUND') {
      message = 'Host não encontrado';
    } else if (err.code === 'ECONNREFUSED') {
      message = 'Conexão recusada - verifique host e porta';
    } else if (err.message.includes('CERT') || err.message.includes('certificate')) {
      message = 'Erro de certificado SSL/TLS';
    }
    client.close();
    return { success: false, message, latency };
  }
}

// Função para testar S3
async function testS3(endpoint, accessKeyId, secretAccessKey, region) {
  const startTime = Date.now();

  try {
    const config = {
      credentials: {
        accessKeyId,
        secretAccessKey
      },
      region: region || 'us-east-1'
    };

    // Se endpoint customizado (MinIO, etc)
    if (endpoint && !endpoint.includes('amazonaws.com')) {
      config.endpoint = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
      config.forcePathStyle = true;
    }

    const client = new S3Client(config);
    const command = new ListBucketsCommand({});
    const response = await client.send(command);
    const latency = Date.now() - startTime;

    return {
      success: true,
      message: `Conectado! ${response.Buckets?.length || 0} buckets encontrados`,
      latency
    };
  } catch (err) {
    const latency = Date.now() - startTime;
    let message = err.message;
    if (err.name === 'InvalidAccessKeyId') {
      message = 'Access Key ID inválido';
    } else if (err.name === 'SignatureDoesNotMatch') {
      message = 'Secret Access Key inválido';
    } else if (err.code === 'ENOTFOUND') {
      message = 'Endpoint não encontrado';
    }
    return { success: false, message, latency };
  }
}

// Função para testar caminho Local
async function testLocal(targetPath) {
  const startTime = Date.now();

  try {
    if (!fs.existsSync(targetPath)) {
      return { success: false, message: 'Caminho não existe', latency: Date.now() - startTime };
    }

    const stats = fs.statSync(targetPath);
    if (!stats.isDirectory()) {
      return { success: false, message: 'O caminho não é um diretório', latency: Date.now() - startTime };
    }

    // Testar permissão de leitura
    const items = fs.readdirSync(targetPath);
    const latency = Date.now() - startTime;

    // Verificar permissão de escrita
    const testFile = path.join(targetPath, '.nexus_write_test');
    let canWrite = false;
    try {
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      canWrite = true;
    } catch (e) {
      // Sem permissão de escrita
    }

    return {
      success: true,
      message: `Acessível! ${items.length} itens. ${canWrite ? 'Leitura/Escrita' : 'Somente leitura'}`,
      latency
    };
  } catch (err) {
    return {
      success: false,
      message: `Erro: ${err.message}`,
      latency: Date.now() - startTime
    };
  }
}

// Função para testar NFS (via sistema de arquivos montado)
async function testNFS(host, mountOptions) {
  const startTime = Date.now();

  // NFS requer montagem no sistema - validamos apenas formato
  if (!host.includes(':')) {
    return {
      success: false,
      message: 'Formato inválido. Use: host:/caminho/export',
      latency: Date.now() - startTime
    };
  }

  const [nfsHost, nfsPath] = host.split(':');

  // Tentar resolver o host
  try {
    const dns = await import('dns');
    await new Promise((resolve, reject) => {
      dns.lookup(nfsHost, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return {
      success: true,
      message: `Host ${nfsHost} encontrado. Monte com: mount -t nfs ${host} /mnt/destino`,
      latency: Date.now() - startTime
    };
  } catch (err) {
    return {
      success: false,
      message: `Host não encontrado: ${nfsHost}`,
      latency: Date.now() - startTime
    };
  }
}

// Função para testar SMB (com verificação de porta)
async function testSMB(host, username, password, domain, port) {
  const startTime = Date.now();

  // Extrair host e share
  let smbHost = host;
  let share = '';

  if (host.includes('/')) {
    [smbHost, share] = host.split('/');
  } else if (host.includes('\\')) {
    [smbHost, share] = host.split('\\');
  }

  // Validar formato
  if (!smbHost) {
    return {
      success: false,
      message: 'Host SMB inválido',
      latency: Date.now() - startTime
    };
  }

  // Tentar resolver o host
  try {
    const dns = await import('dns');
    const net = await import('net');

    // Resolver DNS
    await new Promise((resolve, reject) => {
      dns.lookup(smbHost, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Verificar conectividade na porta SMB (445 por padrão)
    const smbPort = port || 445;
    const portOpen = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(smbPort, smbHost);
    });

    if (!portOpen) {
      return {
        success: false,
        message: `Host encontrado, mas porta ${smbPort} não está acessível`,
        latency: Date.now() - startTime
      };
    }

    const shareInfo = share ? ` Share: ${share}` : '';
    const domainInfo = domain ? ` Domínio: ${domain}` : '';

    return {
      success: true,
      message: `Conectado! Porta ${smbPort} acessível.${shareInfo}${domainInfo}`,
      latency: Date.now() - startTime
    };
  } catch (err) {
    return {
      success: false,
      message: `Host não encontrado: ${smbHost}`,
      latency: Date.now() - startTime
    };
  }
}

// Endpoint de teste de conexão
app.post('/api/connections/test', authenticate, async (req, res) => {
  const { type, host, port, secure, username, password, domain, mountOptions, region } = req.body;

  if (!type) {
    return res.status(400).json({ error: 'Tipo de conexão é obrigatório' });
  }

  try {
    let result;

    switch (type) {
      case 'SFTP':
        if (!host || !username || !password) {
          return res.status(400).json({ error: 'Host, usuário e senha são obrigatórios para SFTP' });
        }
        result = await testSFTP(host, port, username, password);
        break;

      case 'FTP':
        if (!host) {
          return res.status(400).json({ error: 'Host é obrigatório para FTP' });
        }
        result = await testFTP(host, port, username, password, secure);
        break;

      case 'S3':
        if (!username || !password) {
          return res.status(400).json({ error: 'Access Key e Secret Key são obrigatórios para S3' });
        }
        result = await testS3(host, username, password, region);
        break;

      case 'Local':
        if (!host) {
          return res.status(400).json({ error: 'Caminho é obrigatório para conexão Local' });
        }
        result = await testLocal(host);
        break;

      case 'NFS':
        if (!host) {
          return res.status(400).json({ error: 'Host:caminho é obrigatório para NFS' });
        }
        result = await testNFS(host, mountOptions);
        break;

      case 'SMB':
        if (!host) {
          return res.status(400).json({ error: 'Host é obrigatório para SMB' });
        }
        result = await testSMB(host, username, password, domain, port);
        break;

      case 'Google Drive':
      case 'Dropbox':
      case 'OneDrive':
        // OAuth providers - validação real requer implementação OAuth
        result = {
          success: true,
          message: 'Use o botão "Conectar" para autenticação OAuth',
          latency: 0
        };
        break;

      default:
        return res.status(400).json({ error: `Tipo de conexão não suportado: ${type}` });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Erro interno: ${error.message}`,
      latency: 0
    });
  }
});

// --- Rotas OAuth ---

// Iniciar fluxo OAuth
app.get('/api/oauth/authorize/:provider', (req, res) => {
  try {
    const { provider } = req.params;
    const providerKey = provider.toLowerCase().replace(' ', '');

    // Map connection type to provider key
    const providerMap = {
      'googledrive': 'google',
      'google': 'google',
      'dropbox': 'dropbox',
      'onedrive': 'onedrive'
    };

    const configKey = providerMap[providerKey];
    const config = OAUTH_CONFIG[configKey];

    if (!config) {
      return res.status(400).json({ error: `Provedor OAuth não suportado: ${provider}` });
    }

    if (!config.clientId || config.clientId === 'YOUR_GOOGLE_CLIENT_ID' ||
        config.clientId === 'YOUR_DROPBOX_APP_KEY' ||
        config.clientId === 'YOUR_MICROSOFT_CLIENT_ID') {
      return res.status(400).json({
        error: `Credenciais OAuth não configuradas para ${provider}`,
        details: 'Configure as variáveis de ambiente no arquivo .env.local'
      });
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    oauthStates.set(state, {
      provider: configKey,
      createdAt: Date.now()
    });

    // Clean old states (older than 10 minutes)
    for (const [key, value] of oauthStates.entries()) {
      if (Date.now() - value.createdAt > 600000) {
        oauthStates.delete(key);
      }
    }

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: OAUTH_REDIRECT_URI,
      response_type: 'code',
      state,
      access_type: 'offline',
      prompt: 'consent'
    });

    if (config.scopes.length > 0) {
      params.append('scope', config.scopes.join(' '));
    }

    // Dropbox specific
    if (configKey === 'dropbox') {
      params.append('token_access_type', 'offline');
    }

    const authUrl = `${config.authUrl}?${params.toString()}`;
    res.json({ authUrl, state });
  } catch (error) {
    console.error('OAuth authorize error:', error);
    res.status(500).json({
      error: 'Erro ao iniciar autenticação OAuth',
      details: error.message
    });
  }
});

// Callback OAuth
app.get('/api/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(`
      <html>
        <body>
          <script>
            window.opener.postMessage({ type: 'oauth_error', error: '${error}' }, '*');
            window.close();
          </script>
        </body>
      </html>
    `);
  }

  if (!state || !oauthStates.has(state)) {
    return res.send(`
      <html>
        <body>
          <script>
            window.opener.postMessage({ type: 'oauth_error', error: 'Estado inválido ou expirado' }, '*');
            window.close();
          </script>
        </body>
      </html>
    `);
  }

  const { provider } = oauthStates.get(state);
  oauthStates.delete(state);

  const config = OAUTH_CONFIG[provider];

  try {
    // Exchange code for token
    const tokenParams = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams.toString()
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(tokenData.error_description || tokenData.error || 'Erro ao obter token');
    }

    // Get user info
    let userInfo = {};
    const headers = {
      'Authorization': `Bearer ${tokenData.access_token}`
    };

    if (provider === 'dropbox') {
      // Dropbox requires POST for user info
      const userResponse = await fetch(config.userInfoUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: 'null'
      });
      userInfo = await userResponse.json();
      userInfo.email = userInfo.email;
      userInfo.name = userInfo.name?.display_name || userInfo.email;
    } else {
      const userResponse = await fetch(config.userInfoUrl, { headers });
      userInfo = await userResponse.json();
      if (provider === 'onedrive') {
        userInfo.name = userInfo.displayName;
        userInfo.email = userInfo.userPrincipalName || userInfo.mail;
      }
    }

    // Send success message to opener window
    res.send(`
      <html>
        <body>
          <script>
            window.opener.postMessage({
              type: 'oauth_success',
              provider: '${provider}',
              email: '${userInfo.email || ''}',
              name: '${userInfo.name || userInfo.email || ''}'
            }, '*');
            window.close();
          </script>
        </body>
      </html>
    `);

  } catch (error) {
    res.send(`
      <html>
        <body>
          <script>
            window.opener.postMessage({ type: 'oauth_error', error: '${error.message}' }, '*');
            window.close();
          </script>
        </body>
      </html>
    `);
  }
});

// --- Rotas Rclone RCD ---

// Configuração do Rclone RCD
const RCLONE_RCD_URL = process.env.RCLONE_RCD_URL || 'http://localhost:5572';
const RCLONE_RCD_USER = process.env.RCLONE_RCD_USER || '';
const RCLONE_RCD_PASS = process.env.RCLONE_RCD_PASS || '';

// Helper para fazer requisições ao Rclone RCD
async function rcloneRCD(endpoint, method = 'POST', body = {}) {
  const url = `${RCLONE_RCD_URL}/${endpoint}`;
  const headers = {
    'Content-Type': 'application/json'
  };

  // Adicionar autenticação básica se configurada
  if (RCLONE_RCD_USER && RCLONE_RCD_PASS) {
    const auth = Buffer.from(`${RCLONE_RCD_USER}:${RCLONE_RCD_PASS}`).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? JSON.stringify(body) : undefined
    });
  } catch (fetchError) {
    throw new Error(`Rclone RCD não está rodando. Inicie com: rclone rcd --rc-no-auth --rc-addr=:5572`);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Rclone RCD error: ${response.status}`);
  }

  // Read body as text first, then try to parse as JSON
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (jsonError) {
    throw new Error(`Resposta inválida do Rclone RCD: ${text.substring(0, 100)}`);
  }
}

// Verificar status do Rclone
app.get('/api/rclone/status', authenticate, async (req, res) => {
  try {
    // Primeiro, verificar se rclone está instalado
    let rcloneVersion = null;
    try {
      const version = execSync('rclone version --check', { encoding: 'utf8', timeout: 5000 });
      rcloneVersion = version.split('\n')[0];
    } catch (e) {
      // rclone não está instalado ou não está no PATH
    }

    // Tentar conectar ao RCD
    let rcdRunning = false;
    let rcdInfo = null;

    try {
      const result = await rcloneRCD('core/version');
      rcdRunning = true;
      rcdInfo = result;
    } catch (e) {
      // RCD não está rodando
    }

    res.json({
      installed: !!rcloneVersion,
      version: rcloneVersion,
      rcdRunning,
      rcdUrl: RCLONE_RCD_URL,
      rcdInfo,
      instructions: !rcloneVersion
        ? 'Instale o rclone: https://rclone.org/downloads/'
        : !rcdRunning
        ? `Inicie o RCD com: rclone rcd --rc-no-auth --rc-addr=:5572`
        : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Listar remotes configurados no rclone
app.get('/api/rclone/remotes', authenticate, async (req, res) => {
  try {
    const result = await rcloneRCD('config/listremotes');

    // Obter detalhes de cada remote
    const remotes = [];
    for (const name of result.remotes || []) {
      try {
        const info = await rcloneRCD('config/get', 'POST', { name });
        remotes.push({
          name,
          type: info.type || 'unknown',
          config: info
        });
      } catch (e) {
        remotes.push({ name, type: 'unknown', error: e.message });
      }
    }

    res.json({ remotes });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      hint: 'Verifique se o rclone RCD está rodando'
    });
  }
});

// Criar novo remote no rclone
app.post('/api/rclone/remotes', authenticate, async (req, res) => {
  const { name, type, parameters } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: 'Nome e tipo são obrigatórios' });
  }

  // Validar nome (apenas letras, números, underscore)
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return res.status(400).json({
      error: 'Nome inválido',
      details: 'Use apenas letras, números e underscore'
    });
  }

  try {
    await rcloneRCD('config/create', 'POST', {
      name,
      type,
      parameters: parameters || {}
    });

    res.json({
      success: true,
      message: `Remote "${name}" criado com sucesso`,
      name,
      type
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deletar remote do rclone
app.delete('/api/rclone/remotes/:name', authenticate, async (req, res) => {
  const { name } = req.params;

  console.log(`[Rclone Delete] Attempting to delete remote: ${name}`);

  try {
    // First try via RCD
    try {
      await rcloneRCD('config/delete', 'POST', { name });
      console.log(`[Rclone Delete] Remote "${name}" deleted via RCD`);
      return res.json({
        success: true,
        message: `Remote "${name}" deletado com sucesso`
      });
    } catch (rcdError) {
      console.log(`[Rclone Delete] RCD failed, trying spawn: ${rcdError.message}`);
    }

    // Fallback to spawn command
    const { spawn } = require('child_process');

    await new Promise((resolve, reject) => {
      const process = spawn('rclone', ['config', 'delete', name]);
      let stderr = '';

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          console.log(`[Rclone Delete] Remote "${name}" deleted via spawn`);
          resolve();
        } else {
          // Check if the error is because remote doesn't exist
          if (stderr.includes("didn't find") || stderr.includes('not found')) {
            console.log(`[Rclone Delete] Remote "${name}" not found (already deleted?)`);
            resolve(); // Not an error if it doesn't exist
          } else {
            reject(new Error(stderr || `rclone config delete failed with code ${code}`));
          }
        }
      });

      process.on('error', (err) => {
        reject(err);
      });
    });

    res.json({
      success: true,
      message: `Remote "${name}" deletado com sucesso`
    });
  } catch (error) {
    console.error(`[Rclone Delete] Error deleting remote "${name}":`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Iniciar OAuth para provider via rclone
app.post('/api/rclone/authorize', authenticate, async (req, res) => {
  try {
    console.log('[Rclone Authorize] Request body:', req.body);
    const { type, name } = req.body;

    if (!type || !name) {
      return res.status(400).json({ error: 'Tipo e nome são obrigatórios' });
    }

    // Não criar via RCD para evitar conflito de porta OAuth
    // A criação será feita pelo spawn no endpoint authorize-browser
    res.json({
      success: true,
      message: `Pronto para autorizar "${name}"`,
      needsAuth: true,
      remoteName: name
    });
  } catch (error) {
    console.error('[Rclone Authorize] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para iniciar autorização OAuth via spawn (abre navegador)
app.post('/api/rclone/authorize-browser', authenticate, async (req, res) => {
  const { remoteName, remoteType } = req.body;

  if (!remoteName) {
    return res.status(400).json({ error: 'Nome do remote é obrigatório' });
  }

  try {
    const isWindows = process.platform === 'win32';

    // Mapear tipos para nomes do rclone
    const typeMap = {
      'Google Drive': 'drive',
      'Dropbox': 'dropbox',
      'OneDrive': 'onedrive',
      'GDRIVE': 'drive',
      'DROPBOX': 'dropbox',
      'ONEDRIVE': 'onedrive'
    };

    const rcloneType = typeMap[remoteType] || remoteType?.toLowerCase() || 'drive';

    if (isWindows) {
      // Fazer tudo no terminal para que o rclone possa abrir o navegador
      const cmdProcess = spawn('cmd', [
        '/c',
        'start',
        'cmd',
        '/k',
        `echo Criando remote ${remoteName}... && (rclone config delete ${remoteName} >nul 2>&1 || echo.) && rclone config create ${remoteName} ${rcloneType} && echo. && echo Autorizacao concluida! Pode fechar esta janela. && pause`
      ], {
        detached: true,
        stdio: 'ignore',
        shell: true
      });

      cmdProcess.unref();

      res.json({
        success: true,
        message: 'Terminal aberto. Complete a autorização no navegador.',
        windowOpened: true
      });
    } else {
      // Linux/Mac - usar --auto-confirm para pular prompts
      const reconnectProcess = spawn('rclone', [
        'config', 'reconnect', `${remoteName}:`, '--auto-confirm'
      ], {
        detached: true,
        stdio: 'ignore'
      });

      reconnectProcess.unref();

      res.json({
        success: true,
        message: 'Navegador aberto para autorização. Faça login e autorize o acesso.',
        windowOpened: true
      });
    }

  } catch (error) {
    res.status(500).json({
      error: error.message,
      details: 'Falha ao iniciar autorização'
    });
  }
});

// Listar arquivos de um remote rclone
app.post('/api/rclone/list', authenticate, async (req, res) => {
  const { remote, path: remotePath } = req.body;

  if (!remote) {
    return res.status(400).json({ error: 'Remote é obrigatório' });
  }

  const fsPath = remotePath ? `${remote}:${remotePath}` : `${remote}:`;

  try {
    const result = await rcloneRCD('operations/list', 'POST', {
      fs: fsPath,
      remote: ''
    });

    // Converter formato rclone para FileItem
    const files = (result.list || []).map(item => ({
      id: `rclone-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: item.Name,
      type: item.IsDir ? 'folder' : 'file',
      size: item.Size || 0,
      modifiedAt: item.ModTime || new Date().toISOString(),
      path: remotePath || '/',
      parentId: remotePath || null,
      mimeType: item.MimeType || (item.IsDir ? null : 'application/octet-stream')
    }));

    // Ordenar: pastas primeiro, depois por nome
    files.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });

    res.json(files);
  } catch (error) {
    let message = error.message;
    if (message.includes('didn\'t find section')) {
      message = `Remote "${remote}" não encontrado`;
    } else if (message.includes('token has expired')) {
      message = `Token expirado. Execute: rclone config reconnect ${remote}:`;
    }
    res.status(500).json({ error: message });
  }
});

// Obter informações sobre um remote específico
app.get('/api/rclone/remotes/:name', authenticate, async (req, res) => {
  const { name } = req.params;

  try {
    const config = await rcloneRCD('config/get', 'POST', { name });

    // Tentar obter espaço usado/disponível
    let about = null;
    try {
      about = await rcloneRCD('operations/about', 'POST', {
        fs: `${name}:`
      });
    } catch (e) {
      // Nem todos os backends suportam about
    }

    res.json({
      name,
      type: config.type,
      config,
      about
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Iniciar rclone RCD (se não estiver rodando)
app.post('/api/rclone/start-rcd', authenticate, requireAdmin, async (req, res) => {
  try {
    // Verificar se já está rodando
    try {
      await rcloneRCD('core/version');
      return res.json({
        success: true,
        message: 'Rclone RCD já está rodando',
        alreadyRunning: true
      });
    } catch (e) {
      // Não está rodando, vamos iniciar
    }

    // Iniciar rclone rcd em background
    const rcdProcess = spawn('rclone', [
      'rcd',
      '--rc-no-auth',
      '--rc-addr=:5572',
      '--rc-allow-origin=*'
    ], {
      detached: true,
      stdio: 'ignore'
    });

    rcdProcess.unref();

    // Esperar um pouco e verificar se iniciou
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const version = await rcloneRCD('core/version');
      res.json({
        success: true,
        message: 'Rclone RCD iniciado com sucesso',
        pid: rcdProcess.pid,
        version
      });
    } catch (e) {
      res.status(500).json({
        error: 'Falha ao iniciar rclone RCD',
        details: 'Verifique se o rclone está instalado e no PATH'
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- File Operations via Rclone ---

// Download file
app.get('/api/rclone/download', authenticate, async (req, res) => {
  const { remote, path: filePath, isDir } = req.query;

  if (!remote || !filePath) {
    return res.status(400).json({ error: 'Remote e path são obrigatórios' });
  }

  try {
    const fileName = filePath.split('/').pop();

    // If it's a directory, download as zip
    if (isDir === 'true') {
      const tempDir = path.join(__dirname, 'temp', `download-${Date.now()}`);
      const zipFileName = `${fileName}.zip`;

      // Create temp directory
      fs.mkdirSync(tempDir, { recursive: true });

      // Download folder using rclone copy (--drive-acknowledge-abuse allows downloading flagged files)
      const copyProcess = spawn('rclone', ['copy', `${remote}:${filePath}`, tempDir, '--progress', '--drive-acknowledge-abuse']);

      let copyError = '';
      copyProcess.stderr.on('data', (data) => {
        copyError += data.toString();
      });

      copyProcess.on('close', async (code) => {
        if (code !== 0) {
          // Clean up
          fs.rmSync(tempDir, { recursive: true, force: true });
          if (!res.headersSent) {
            return res.status(500).json({ error: `Erro ao baixar pasta: ${copyError}` });
          }
          return;
        }

        try {
          // Create zip using PowerShell (Windows) or zip command (Unix)
          const zipPath = path.join(__dirname, 'temp', zipFileName);

          const isWindows = process.platform === 'win32';
          let zipProcess;

          if (isWindows) {
            zipProcess = spawn('powershell', [
              '-Command',
              `Compress-Archive -Path "${tempDir}\\*" -DestinationPath "${zipPath}" -Force`
            ]);
          } else {
            zipProcess = spawn('zip', ['-r', zipPath, '.'], { cwd: tempDir });
          }

          zipProcess.on('close', (zipCode) => {
            // Clean up temp folder
            fs.rmSync(tempDir, { recursive: true, force: true });

            if (zipCode !== 0) {
              if (!res.headersSent) {
                return res.status(500).json({ error: 'Erro ao criar arquivo ZIP' });
              }
              return;
            }

            // Send zip file
            res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
            res.setHeader('Content-Type', 'application/zip');

            const zipStream = fs.createReadStream(zipPath);
            zipStream.pipe(res);

            zipStream.on('end', () => {
              // Clean up zip file
              fs.unlinkSync(zipPath);
            });

            zipStream.on('error', (err) => {
              console.error('Zip stream error:', err);
              fs.unlinkSync(zipPath);
              if (!res.headersSent) {
                res.status(500).json({ error: 'Erro ao enviar arquivo ZIP' });
              }
            });
          });

          zipProcess.on('error', (err) => {
            fs.rmSync(tempDir, { recursive: true, force: true });
            if (!res.headersSent) {
              res.status(500).json({ error: 'Erro ao criar ZIP: ' + err.message });
            }
          });
        } catch (zipErr) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          if (!res.headersSent) {
            res.status(500).json({ error: zipErr.message });
          }
        }
      });

      copyProcess.on('error', (error) => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Erro ao iniciar download: ' + error.message });
        }
      });

      return;
    }

    // Regular file download
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    // Use spawn to stream file content directly
    const rcloneProcess = spawn('rclone', ['cat', `${remote}:${filePath}`]);

    rcloneProcess.stdout.pipe(res);

    rcloneProcess.stderr.on('data', (data) => {
      console.error('Rclone stderr:', data.toString());
    });

    rcloneProcess.on('error', (error) => {
      console.error('Rclone spawn error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro ao iniciar rclone' });
      }
    });

    rcloneProcess.on('close', (code) => {
      if (code !== 0 && !res.headersSent) {
        res.status(500).json({ error: `Rclone exited with code ${code}` });
      }
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete file or folder
app.delete('/api/rclone/files', authenticate, async (req, res) => {
  const { remote, path: filePath, isDir } = req.body;

  if (!remote || !filePath) {
    return res.status(400).json({ error: 'Remote e path são obrigatórios' });
  }

  try {
    if (isDir) {
      // Delete directory recursively
      await rcloneRCD('operations/purge', 'POST', {
        fs: `${remote}:`,
        remote: filePath
      });
    } else {
      // Delete single file
      await rcloneRCD('operations/deletefile', 'POST', {
        fs: `${remote}:`,
        remote: filePath
      });
    }

    res.json({ success: true, message: 'Item excluído com sucesso' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create folder
app.post('/api/rclone/mkdir', authenticate, async (req, res) => {
  const { remote, path: folderPath } = req.body;

  if (!remote || !folderPath) {
    return res.status(400).json({ error: 'Remote e path são obrigatórios' });
  }

  try {
    await rcloneRCD('operations/mkdir', 'POST', {
      fs: `${remote}:`,
      remote: folderPath
    });

    res.json({ success: true, message: 'Pasta criada com sucesso' });
  } catch (error) {
    console.error('Mkdir error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Rename file or folder
app.post('/api/rclone/rename', authenticate, async (req, res) => {
  const { remote, oldPath, newPath } = req.body;

  if (!remote || !oldPath || !newPath) {
    return res.status(400).json({ error: 'Remote, oldPath e newPath são obrigatórios' });
  }

  try {
    await rcloneRCD('operations/movefile', 'POST', {
      srcFs: `${remote}:`,
      srcRemote: oldPath,
      dstFs: `${remote}:`,
      dstRemote: newPath
    });

    res.json({ success: true, message: 'Item renomeado com sucesso' });
  } catch (error) {
    console.error('Rename error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Move file or folder
app.post('/api/rclone/move', authenticate, async (req, res) => {
  const { srcRemote, srcPath, dstRemote, dstPath, isDir } = req.body;

  if (!srcRemote || !srcPath || !dstRemote || !dstPath) {
    return res.status(400).json({ error: 'Todos os parâmetros são obrigatórios' });
  }

  try {
    if (isDir) {
      await rcloneRCD('sync/move', 'POST', {
        srcFs: `${srcRemote}:${srcPath}`,
        dstFs: `${dstRemote}:${dstPath}`
      });
    } else {
      await rcloneRCD('operations/movefile', 'POST', {
        srcFs: `${srcRemote}:`,
        srcRemote: srcPath,
        dstFs: `${dstRemote}:`,
        dstRemote: dstPath
      });
    }

    res.json({ success: true, message: 'Item movido com sucesso' });
  } catch (error) {
    console.error('Move error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Copy file or folder
app.post('/api/rclone/copy', authenticate, async (req, res) => {
  const { srcRemote, srcPath, dstRemote, dstPath, isDir } = req.body;

  if (!srcRemote || !srcPath || !dstRemote || !dstPath) {
    return res.status(400).json({ error: 'Todos os parâmetros são obrigatórios' });
  }

  try {
    if (isDir) {
      await rcloneRCD('sync/copy', 'POST', {
        srcFs: `${srcRemote}:${srcPath}`,
        dstFs: `${dstRemote}:${dstPath}`
      });
    } else {
      await rcloneRCD('operations/copyfile', 'POST', {
        srcFs: `${srcRemote}:`,
        srcRemote: srcPath,
        dstFs: `${dstRemote}:`,
        dstRemote: dstPath
      });
    }

    res.json({ success: true, message: 'Item copiado com sucesso' });
  } catch (error) {
    console.error('Copy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate public link (share)
app.post('/api/rclone/publiclink', authenticate, async (req, res) => {
  const { remote, path: filePath } = req.body;

  if (!remote || !filePath) {
    return res.status(400).json({ error: 'Remote e path são obrigatórios' });
  }

  try {
    const result = await rcloneRCD('operations/publiclink', 'POST', {
      fs: `${remote}:`,
      remote: filePath
    });

    res.json({
      success: true,
      url: result.url,
      message: 'Link público gerado com sucesso'
    });
  } catch (error) {
    console.error('Public link error:', error);
    // Some backends don't support public links
    if (error.message.includes('not supported')) {
      res.status(400).json({ error: 'Este provedor não suporta links públicos' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Cross-server file transfer
app.post('/api/fs/transfer', authenticate, async (req, res) => {
  const { srcConnection, dstConnection, srcPath, dstPath, fileName, isMove, isDir } = req.body;

  if (isDir) {
    return res.status(400).json({ error: 'Transferência de pastas entre servidores não é suportada ainda' });
  }

  const tempFile = path.join(__dirname, `temp_${Date.now()}_${fileName}`);

  try {
    // Step 1: Download from source
    const srcCreds = getConnectionCredentials(srcConnection.id, req.user.id);
    const srcType = (srcConnection.type || '').toLowerCase();

    if (srcType === 'sftp') {
      const { client, sftp } = await connectSFTP(
        srcConnection.host,
        srcCreds?.port || srcConnection.port || 22,
        srcCreds?.username,
        srcCreds?.password
      );
      await new Promise((resolve, reject) => {
        sftp.fastGet(srcPath, tempFile, (err) => {
          client.end();
          if (err) reject(err);
          else resolve();
        });
      });
    } else if (srcType === 'ftp') {
      const ftpClient = new ftp.Client();
      await ftpClient.access({
        host: srcConnection.host,
        port: srcCreds?.port || srcConnection.port || 21,
        user: srcCreds?.username,
        password: srcCreds?.password,
        secure: srcCreds?.secure ? 'implicit' : false
      });
      await ftpClient.downloadTo(tempFile, srcPath);
      ftpClient.close();
    } else if (srcType === 's3') {
      const s3Client = createS3Client(srcConnection.host, srcCreds?.username, srcCreds?.password, srcConnection.region);
      const srcKey = srcPath.startsWith('/') ? srcPath.substring(1) : srcPath;
      const command = new GetObjectCommand({ Bucket: srcConnection.bucket, Key: srcKey });
      const response = await s3Client.send(command);
      const writeStream = fs.createWriteStream(tempFile);
      await new Promise((resolve, reject) => {
        response.Body.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
    } else {
      throw new Error(`Tipo de conexão origem não suportado: ${srcConnection.type}`);
    }

    // Step 2: Upload to destination
    const dstCreds = getConnectionCredentials(dstConnection.id, req.user.id);
    const dstType = (dstConnection.type || '').toLowerCase();

    if (dstType === 'sftp') {
      const { client, sftp } = await connectSFTP(
        dstConnection.host,
        dstCreds?.port || dstConnection.port || 22,
        dstCreds?.username,
        dstCreds?.password
      );
      await new Promise((resolve, reject) => {
        sftp.fastPut(tempFile, dstPath, (err) => {
          client.end();
          if (err) reject(err);
          else resolve();
        });
      });
    } else if (dstType === 'ftp') {
      const ftpClient = new ftp.Client();
      await ftpClient.access({
        host: dstConnection.host,
        port: dstCreds?.port || dstConnection.port || 21,
        user: dstCreds?.username,
        password: dstCreds?.password,
        secure: dstCreds?.secure ? 'implicit' : false
      });
      await ftpClient.uploadFrom(tempFile, dstPath);
      ftpClient.close();
    } else if (dstType === 's3') {
      const s3Client = createS3Client(dstConnection.host, dstCreds?.username, dstCreds?.password, dstConnection.region);
      const dstKey = dstPath.startsWith('/') ? dstPath.substring(1) : dstPath;
      const fileBuffer = fs.readFileSync(tempFile);
      const command = new PutObjectCommand({ Bucket: dstConnection.bucket, Key: dstKey, Body: fileBuffer });
      await s3Client.send(command);
    } else {
      throw new Error(`Tipo de conexão destino não suportado: ${dstConnection.type}`);
    }

    // Step 3: If move, delete from source
    if (isMove) {
      if (srcType === 'sftp') {
        const { client, sftp } = await connectSFTP(
          srcConnection.host,
          srcCreds?.port || srcConnection.port || 22,
          srcCreds?.username,
          srcCreds?.password
        );
        await new Promise((resolve, reject) => {
          sftp.unlink(srcPath, (err) => {
            client.end();
            if (err) reject(err);
            else resolve();
          });
        });
      } else if (srcType === 'ftp') {
        const ftpClient = new ftp.Client();
        await ftpClient.access({
          host: srcConnection.host,
          port: srcCreds?.port || srcConnection.port || 21,
          user: srcCreds?.username,
          password: srcCreds?.password,
          secure: srcCreds?.secure ? 'implicit' : false
        });
        await ftpClient.remove(srcPath);
        ftpClient.close();
      } else if (srcType === 's3') {
        const s3Client = createS3Client(srcConnection.host, srcCreds?.username, srcCreds?.password, srcConnection.region);
        const srcKey = srcPath.startsWith('/') ? srcPath.substring(1) : srcPath;
        const command = new DeleteObjectsCommand({ Bucket: srcConnection.bucket, Delete: { Objects: [{ Key: srcKey }] } });
        await s3Client.send(command);
      }
    }

    // Cleanup temp file
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

    res.json({ success: true, message: isMove ? 'Arquivo movido com sucesso' : 'Arquivo copiado com sucesso' });
  } catch (error) {
    // Cleanup temp file on error
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    console.error('Transfer error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fallback para o Frontend (SPA) - Redireciona qualquer rota desconhecida para o index.html do React
app.get('*', (req, res) => {
  // Ignora requisições de API
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API endpoint not found' });
  
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(500).send('Erro: Build de frontend não encontrado. Verifique se "npm run build" foi executado.');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor NexusCloud rodando na porta ${PORT}`);
});