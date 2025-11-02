# 📋 RESUMO - Script de Instalação VPS TimePulse AI

## ✅ O QUE FOI CRIADO

### 1. **Script de Instalação Completo** (`install-timepulse-vps.sh`)
Script automatizado que instala TUDO em uma VPS zerada com um único comando.

### 2. **Documentação Completa**
- `README_VPS.md` - Visão geral e início rápido
- `INSTALACAO_VPS.md` - Guia completo e detalhado  
- `QUICK_START_VPS.md` - Guia ultra-rápido (3 comandos)
- `RESUMO_INSTALACAO_VPS.md` - Este arquivo (resumo executivo)

## 🚀 COMO USAR (3 PASSOS)

### Passo 1: Conectar na VPS
```bash
ssh root@IP_DA_SUA_VPS
```

### Passo 2: Baixar e Preparar Script
```bash
wget https://raw.githubusercontent.com/luisleite-labs/timepulse-ai/main/install-timepulse-vps.sh
chmod +x install-timepulse-vps.sh
```

### Passo 3: Executar Instalação
```bash
sudo ./install-timepulse-vps.sh timepulseai.com.br luisleite@timepulseai.com.br
```

## 🔧 O QUE O SCRIPT FAZ AUTOMATICAMENTE

### 1. Sistema Base (Etapas 1-5)
- ✅ Atualiza sistema operacional
- ✅ Instala dependências essenciais
- ✅ Instala Docker CE + Docker Compose v2
- ✅ Instala Apache2 com módulos (proxy, ssl, rewrite)
- ✅ Instala Certbot (Let's Encrypt)
- ✅ Configura Firewall UFW (portas 22, 80, 443)

### 2. Aplicação (Etapas 6-8)
- ✅ Cria estrutura de diretórios em `/opt/timepulse`
- ✅ Solicita e configura variáveis de ambiente (.env)
- ✅ Cria Dockerfile otimizado
- ✅ Cria docker-compose.yml com healthcheck
- ✅ Copia arquivos do projeto

### 3. Apache + SSL (Etapas 9-10)
- ✅ Configura Apache como proxy reverso
- ✅ Gera certificado SSL Let's Encrypt automaticamente
- ✅ Configura HTTPS com redirecionamento
- ✅ Ativa renovação automática de certificados

### 4. Deploy e Verificação
- ✅ Build da imagem Docker
- ✅ Inicia containers
- ✅ Verifica saúde do sistema
- ✅ Testa conectividade

## 🔐 VARIÁVEIS DE AMBIENTE SOLICITADAS

Durante a instalação, o script pedirá:

### Supabase (Obrigatório)
- `SUPABASE_URL` - URL do projeto Supabase
- `SUPABASE_ANON_KEY` - Chave pública
- `SUPABASE_SERVICE_ROLE_KEY` - Chave de serviço

### OpenAI (Assistente Virtual)
- `OPENAI_API_KEY` - Chave da API OpenAI

### Mapbox (Mapas)
- `MAPBOX_TOKEN` - Token de acesso Mapbox

### Evolution API (WhatsApp)
- `EVOLUTION_API_BASE_URL` - URL da Evolution API
- `EVOLUTION_API_KEY` - Chave de autenticação

## 📊 RESULTADO FINAL

Após 5-10 minutos de instalação:

### ✅ Sistema Online
- 🌐 **HTTPS:** https://timepulseai.com.br
- 🔒 **SSL:** Certificado Let's Encrypt válido
- 🔄 **Renovação:** Automática a cada 90 dias
- 🐳 **Docker:** Container rodando com healthcheck
- 🌐 **Apache:** Proxy reverso configurado
- 🔥 **Firewall:** UFW ativo e configurado

### 📁 Estrutura Criada
```
/opt/timepulse/
├── .env                    # Variáveis (600 - seguro)
├── docker-compose.yml      # Orquestração
├── Dockerfile             # Imagem Docker
├── server.js              # Servidor Node.js
├── package.json           # Dependências
├── public/                # Frontend
├── api/                   # Backend
├── logs/                  # Logs
└── ssl/                   # Certificados
```

## 🛠️ COMANDOS ÚTEIS

### Ver Logs
```bash
docker compose -f /opt/timepulse/docker-compose.yml logs -f
```

### Reiniciar Aplicação
```bash
docker compose -f /opt/timepulse/docker-compose.yml restart
```

### Status Apache
```bash
systemctl status apache2
```

### Verificar SSL
```bash
certbot certificates
```

### Health Check
```bash
curl https://timepulseai.com.br/api/health
```

## 🔒 SEGURANÇA IMPLEMENTADA

- ✅ **Firewall UFW** - Portas 22, 80, 443 configuradas
- ✅ **SSL A+ Rating** - Let's Encrypt com HSTS
- ✅ **Headers de Segurança** - X-Frame-Options, CSP, etc
- ✅ **CORS Configurado** - Apenas domínios autorizados
- ✅ **Variáveis Protegidas** - .env com permissões 600
- ✅ **Network Isolada** - Containers em rede própria
- ✅ **Healthcheck** - Monitoramento de saúde automático

## 📝 REQUISITOS DA VPS

### Mínimo
- **OS:** Ubuntu 20.04/22.04 ou Debian 11/12
- **RAM:** 2GB
- **Disco:** 20GB
- **CPU:** 1 vCPU

### Pré-requisitos
- ✅ Acesso root via SSH
- ✅ Domínio configurado no DNS apontando para o IP
- ✅ Credenciais das APIs (Supabase, OpenAI, etc)

## 🎯 PRÓXIMOS PASSOS APÓS INSTALAÇÃO

1. ✅ Verificar se domínio aponta para o IP: `ping timepulseai.com.br`
2. ✅ Acessar o sistema: https://timepulseai.com.br
3. ✅ Verificar health check: https://timepulseai.com.br/api/health
4. ✅ Fazer backup do .env: `cp /opt/timepulse/.env ~/backup-env.txt`
5. ✅ Configurar domínios adicionais (se necessário)

## 📖 DOCUMENTAÇÃO COMPLETA

- 📘 **Guia Completo:** [INSTALACAO_VPS.md](./INSTALACAO_VPS.md)
- ⚡ **Quick Start:** [QUICK_START_VPS.md](./QUICK_START_VPS.md)
- 📌 **README VPS:** [README_VPS.md](./README_VPS.md)

## ✅ CHECKLIST DE INSTALAÇÃO

Antes de executar:
- [ ] VPS com Ubuntu/Debian instalado
- [ ] Acesso root configurado
- [ ] Domínio apontando para o IP
- [ ] Credenciais das APIs prontas

Durante a instalação:
- [ ] Script baixado e com permissão de execução
- [ ] Domínio e email informados corretamente
- [ ] Variáveis de ambiente fornecidas

Após instalação:
- [ ] Sistema acessível via HTTPS
- [ ] Certificado SSL válido
- [ ] Health check respondendo
- [ ] Backup do .env realizado

## 🆘 RESOLUÇÃO DE PROBLEMAS

### Container não inicia
```bash
docker compose -f /opt/timepulse/docker-compose.yml logs
```

### SSL não funciona
```bash
certbot --apache --domains timepulseai.com.br
```

### Apache não responde
```bash
systemctl status apache2
tail -f /var/log/apache2/error.log
```

---

## 🎉 TUDO PRONTO!

**Seu TimePulse AI estará rodando em:**
### 🌐 https://timepulseai.com.br

Com:
- ✅ Docker containerizado
- ✅ Apache como proxy reverso  
- ✅ SSL/HTTPS automático
- ✅ Firewall configurado
- ✅ Renovação de certificados automática
- ✅ Logs centralizados
- ✅ Healthcheck ativo

**Instalação completa em ~5-10 minutos!** 🚀
