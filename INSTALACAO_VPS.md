# 🚀 Guia de Instalação TimePulse AI em VPS

## 📋 Pré-requisitos

- VPS com Ubuntu 20.04/22.04 ou Debian 11/12
- Acesso root (sudo)
- Domínio apontando para o IP da VPS
- Portas 80, 443 e 22 liberadas no firewall

## ⚡ Instalação Rápida (Método Recomendado)

### 1. Preparar o servidor

```bash
# Conectar via SSH
ssh root@seu-servidor-ip

# Atualizar sistema
apt update && apt upgrade -y
```

### 2. Baixar e executar o instalador

```bash
# Fazer download do script
wget https://raw.githubusercontent.com/SEU_REPO/timepulse-ai/main/install-timepulse-vps.sh

# Dar permissão de execução
chmod +x install-timepulse-vps.sh

# Executar instalador
sudo ./install-timepulse-vps.sh timepulseai.com.br luisleite@timepulseai.com.br
```

### 3. Fornecer as variáveis de ambiente

Durante a instalação, o script solicitará:

#### Supabase (Banco de Dados)
- **Supabase URL**: `https://seu-projeto.supabase.co`
- **Supabase Anon Key**: Chave pública do Supabase
- **Supabase Service Role Key**: Chave de serviço (admin)

#### OpenAI (Assistente Virtual)
- **OpenAI API Key**: Chave da API OpenAI

#### Mapbox (Mapas)
- **Mapbox Token**: Token de acesso do Mapbox

#### Evolution API (WhatsApp)
- **Evolution API Base URL**: `https://seu-evolution.com`
- **Evolution API Key**: Chave da Evolution API

## 🔧 O que o script faz automaticamente

### 1. Instalação do Sistema Base
- ✅ Atualiza o sistema operacional
- ✅ Instala dependências necessárias
- ✅ Configura firewall (UFW)

### 2. Docker
- ✅ Instala Docker CE
- ✅ Instala Docker Compose v2
- ✅ Configura Docker daemon
- ✅ Cria network isolada

### 3. Apache2
- ✅ Instala Apache2
- ✅ Habilita módulos necessários (proxy, ssl, rewrite)
- ✅ Configura proxy reverso para Docker
- ✅ Configura WebSocket support

### 4. SSL/HTTPS
- ✅ Instala Certbot (Let's Encrypt)
- ✅ Gera certificado SSL automaticamente
- ✅ Configura HTTPS com redirecionamento
- ✅ Ativa renovação automática

### 5. TimePulse AI
- ✅ Cria estrutura de diretórios
- ✅ Copia arquivos do projeto
- ✅ Cria Dockerfile otimizado
- ✅ Configura docker-compose.yml
- ✅ Build da imagem Docker
- ✅ Inicia containers automaticamente

### 6. Segurança
- ✅ Arquivo .env com permissões 600
- ✅ Headers de segurança configurados
- ✅ Firewall configurado
- ✅ SSL A+ rating

## 📁 Estrutura de Arquivos Criada

```
/opt/timepulse/
├── .env                    # Variáveis de ambiente (SECRETO)
├── docker-compose.yml      # Configuração Docker Compose
├── Dockerfile             # Imagem Docker
├── server.js              # Servidor Node.js
├── package.json           # Dependências npm
├── public/                # Arquivos estáticos (frontend)
├── api/                   # Endpoints da API
├── logs/                  # Logs da aplicação
└── ssl/                   # Certificados (backup)
```

## 🌐 Acesso ao Sistema

Após a instalação:

- **HTTPS**: https://timepulseai.com.br
- **HTTP**: http://timepulseai.com.br (redireciona para HTTPS)

## 🔧 Comandos Úteis

### Gerenciar Containers

```bash
# Ver logs em tempo real
docker compose -f /opt/timepulse/docker-compose.yml logs -f

# Reiniciar aplicação
docker compose -f /opt/timepulse/docker-compose.yml restart

# Parar aplicação
docker compose -f /opt/timepulse/docker-compose.yml down

# Iniciar aplicação
docker compose -f /opt/timepulse/docker-compose.yml up -d

# Rebuild (após mudanças no código)
docker compose -f /opt/timepulse/docker-compose.yml up -d --build
```

### Gerenciar Apache

```bash
# Status do Apache
systemctl status apache2

# Reiniciar Apache
systemctl restart apache2

# Ver logs do Apache
tail -f /var/log/apache2/timepulseai.com.br_error.log
tail -f /var/log/apache2/timepulseai.com.br_access.log

# Testar configuração
apache2ctl configtest
```

### Gerenciar SSL

```bash
# Renovar certificado manualmente
certbot renew

# Verificar status de renovação automática
systemctl status certbot.timer

# Testar renovação (dry-run)
certbot renew --dry-run

# Ver certificados instalados
certbot certificates
```

### Monitoramento

```bash
# Ver uso de recursos dos containers
docker stats

# Ver logs do sistema
journalctl -u docker -f

# Verificar portas em uso
netstat -tulpn | grep -E ':(80|443|3001)'
```

## 🔐 Segurança

### Backup do .env

```bash
# Fazer backup do arquivo de variáveis
cp /opt/timepulse/.env ~/timepulse-env-backup.txt
chmod 600 ~/timepulse-env-backup.txt

# Baixar para seu computador (do seu PC, não do servidor)
scp root@seu-servidor-ip:~/timepulse-env-backup.txt ./
```

### Atualizar Variáveis de Ambiente

```bash
# Editar arquivo .env
nano /opt/timepulse/.env

# Reiniciar aplicação para aplicar mudanças
docker compose -f /opt/timepulse/docker-compose.yml restart
```

## 🚨 Resolução de Problemas

### Container não inicia

```bash
# Ver logs do container
docker compose -f /opt/timepulse/docker-compose.yml logs

# Verificar se as variáveis estão corretas
cat /opt/timepulse/.env

# Rebuild forçado
docker compose -f /opt/timepulse/docker-compose.yml down
docker compose -f /opt/timepulse/docker-compose.yml up -d --build
```

### SSL não funciona

```bash
# Verificar se o domínio aponta para o servidor
ping timepulseai.com.br

# Verificar portas abertas
ufw status

# Regenerar certificado
certbot --apache --domains timepulseai.com.br --domains www.timepulseai.com.br
```

### Apache não responde

```bash
# Verificar status
systemctl status apache2

# Ver erros
tail -f /var/log/apache2/error.log

# Reiniciar
systemctl restart apache2
```

### Aplicação não responde

```bash
# Verificar se container está rodando
docker ps

# Verificar logs da aplicação
docker compose -f /opt/timepulse/docker-compose.yml logs -f timepulse

# Testar conexão direta ao container
curl http://localhost:3001/api/health
```

## 📊 Monitoramento

### Verificar saúde da aplicação

```bash
# Health check endpoint
curl http://localhost:3001/api/health

# Via HTTPS público
curl https://timepulseai.com.br/api/health
```

### Logs importantes

```bash
# Logs da aplicação
docker compose -f /opt/timepulse/docker-compose.yml logs -f

# Logs do Apache
tail -f /var/log/apache2/timepulseai.com.br_access.log

# Logs do sistema
journalctl -xe
```

## 🔄 Atualização da Aplicação

### Atualizar código

```bash
# 1. Parar containers
docker compose -f /opt/timepulse/docker-compose.yml down

# 2. Fazer backup
cp -r /opt/timepulse /opt/timepulse-backup-$(date +%Y%m%d)

# 3. Atualizar arquivos (git pull ou copiar novos arquivos)
cd /opt/timepulse
# ... copiar novos arquivos ...

# 4. Rebuild e restart
docker compose build
docker compose up -d

# 5. Verificar logs
docker compose logs -f
```

## 📝 Manutenção

### Limpeza de Recursos

```bash
# Remover imagens antigas
docker image prune -a

# Remover containers parados
docker container prune

# Remover volumes não utilizados
docker volume prune

# Limpar tudo (CUIDADO!)
docker system prune -a
```

### Backup Completo

```bash
# Criar backup completo
tar -czf timepulse-backup-$(date +%Y%m%d).tar.gz /opt/timepulse/

# Baixar backup
scp root@seu-servidor-ip:~/timepulse-backup-*.tar.gz ./
```

## 🆘 Suporte

Em caso de problemas:

1. Verifique os logs: `docker compose logs -f`
2. Verifique o Apache: `systemctl status apache2`
3. Verifique o SSL: `certbot certificates`
4. Teste a conectividade: `curl http://localhost:3001/api/health`

## ✅ Checklist Pós-Instalação

- [ ] Domínio aponta para o IP do servidor
- [ ] HTTPS funciona (https://timepulseai.com.br)
- [ ] Certificado SSL válido e renovação automática ativa
- [ ] Aplicação responde em /api/health
- [ ] Firewall configurado corretamente
- [ ] Backup do .env realizado
- [ ] Logs sendo gerados corretamente
- [ ] Todas as variáveis de ambiente configuradas

## 🎉 Pronto!

Seu TimePulse AI está instalado e rodando com:
- ✅ Docker containerizado
- ✅ Apache como proxy reverso
- ✅ SSL/HTTPS automático
- ✅ Renovação de certificado automática
- ✅ Firewall configurado
- ✅ Logs centralizados
- ✅ Sistema de saúde (healthcheck)

Acesse: **https://timepulseai.com.br** 🚀
