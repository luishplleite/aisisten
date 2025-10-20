# ⚡ Quick Start - Instalação VPS TimePulse AI

## 🚀 Instalação em 3 Comandos

### 1️⃣ Preparar servidor
```bash
ssh root@seu-servidor-ip
apt update && apt upgrade -y
```

### 2️⃣ Baixar e executar instalador
```bash
wget https://raw.githubusercontent.com/luisleite-labs/timepulse-ai/main/install-timepulse-vps.sh
chmod +x install-timepulse-vps.sh
sudo ./install-timepulse-vps.sh timepulseai.com.br luisleite@timepulseai.com.br
```

### 3️⃣ Fornecer credenciais quando solicitado
O script vai pedir:
- ✅ Supabase URL, Anon Key e Service Role Key
- ✅ OpenAI API Key
- ✅ Mapbox Token
- ✅ Evolution API URL e Key

## ✅ O que será instalado

- 🐳 **Docker + Docker Compose** - Containerização
- 🌐 **Apache2** - Servidor web com proxy reverso
- 🔒 **Let's Encrypt SSL** - Certificado HTTPS automático
- 🚀 **TimePulse AI** - Aplicação rodando em container
- 🔥 **UFW Firewall** - Segurança de rede
- 🔄 **Auto-renewal SSL** - Renovação automática de certificados

## 📊 Após Instalação

**Sistema disponível em:**
- 🌐 https://timepulseai.com.br (HTTPS automático)

**Comandos úteis:**
```bash
# Ver logs
docker compose -f /opt/timepulse/docker-compose.yml logs -f

# Reiniciar
docker compose -f /opt/timepulse/docker-compose.yml restart

# Status Apache
systemctl status apache2
```

## 🎯 Requisitos Mínimos

- Ubuntu 20.04/22.04 ou Debian 11/12
- 2GB RAM
- 20GB disco
- 1 vCPU
- Domínio apontando para o IP

---

**Documentação completa:** [INSTALACAO_VPS.md](./INSTALACAO_VPS.md)
