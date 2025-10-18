# 🚀 TimePulse AI - Instalação VPS Automatizada

## ⚡ Instalação Rápida

Execute estes 3 comandos na sua VPS:

```bash
# 1. Baixar instalador
wget https://raw.githubusercontent.com/luisleite-labs/timepulse-ai/main/install-timepulse-vps.sh

# 2. Dar permissão
chmod +x install-timepulse-vps.sh

# 3. Executar (substitua com seus dados)
sudo ./install-timepulse-vps.sh timepulseai.com.br luisleite@timepulseai.com.br
```

## 📦 O que será instalado automaticamente

- ✅ **Docker + Docker Compose** - Containerização
- ✅ **Apache2** - Proxy reverso + servidor web
- ✅ **SSL/HTTPS** - Certificado Let's Encrypt automático
- ✅ **Firewall (UFW)** - Portas 22, 80, 443 configuradas
- ✅ **TimePulse AI** - Aplicação em container Docker
- ✅ **Auto-renewal SSL** - Renovação automática de certificados

## 🔐 Variáveis de Ambiente

Durante a instalação, você precisará fornecer:

### Supabase (Obrigatório)
- URL do Supabase
- Anon Key
- Service Role Key

### APIs Opcionais
- OpenAI API Key (assistente virtual)
- Mapbox Token (mapas)
- Evolution API URL + Key (WhatsApp)

## 🌐 Resultado

Após ~5-10 minutos de instalação:

**Sistema disponível em:**
- 🔒 https://timepulseai.com.br (HTTPS automático)
- 🔄 Redirecionamento HTTP → HTTPS
- ✅ Certificado SSL válido
- 🔄 Renovação automática a cada 90 dias

## 📁 Arquivos do Projeto

- **install-timepulse-vps.sh** - Script de instalação completo
- **INSTALACAO_VPS.md** - Documentação detalhada
- **QUICK_START_VPS.md** - Guia rápido

## 🛠️ Comandos Úteis Pós-Instalação

```bash
# Ver logs
docker compose -f /opt/timepulse/docker-compose.yml logs -f

# Reiniciar aplicação
docker compose -f /opt/timepulse/docker-compose.yml restart

# Status do Apache
systemctl status apache2

# Verificar SSL
certbot certificates

# Health check
curl https://timepulseai.com.br/api/health
```

## 📊 Requisitos da VPS

- **OS:** Ubuntu 20.04/22.04 ou Debian 11/12
- **RAM:** 2GB mínimo
- **Disco:** 20GB mínimo
- **CPU:** 1 vCPU mínimo
- **Domínio:** Apontando para o IP da VPS

## 🔒 Segurança

- Firewall UFW configurado
- SSL A+ rating (Let's Encrypt)
- Headers de segurança (Helmet)
- CORS configurado
- Variáveis em .env protegido (600)
- Containers isolados em network própria

## 📖 Documentação

- 📘 [Guia Completo](./INSTALACAO_VPS.md) - Documentação detalhada
- ⚡ [Quick Start](./QUICK_START_VPS.md) - Início rápido

## ✅ Checklist de Instalação

Antes de começar:
- [ ] VPS com Ubuntu/Debian instalado
- [ ] Acesso root (SSH)
- [ ] Domínio configurado no DNS apontando para o IP
- [ ] Credenciais das APIs prontas (Supabase, OpenAI, etc)

## 🆘 Suporte

Problemas? Verifique:
1. Logs: `docker compose -f /opt/timepulse/docker-compose.yml logs`
2. Apache: `systemctl status apache2`
3. Domínio: `ping timepulseai.com.br`
4. SSL: `certbot certificates`

---

**Desenvolvido para instalação zero-config em VPS** 🚀
