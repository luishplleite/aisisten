# JFA PWA Toolkit Demo

## Overview
This project demonstrates the [JFA PWA Toolkit](https://github.com/jfadev/jfa-pwa-toolkit/) with two applications:

1. **PWA Toolkit Demo** (`index.html`) - Original demo showcasing PWA features
2. **TimePulse AI Driver App** (`driver.html`) - Complete delivery driver application with mandatory PWA installation

### Key PWA Features
- Service Workers
- Offline functionality
- Push notifications
- App caching strategies
- Browser notifications
- **Mandatory PWA installation for mobile devices**
- iOS and Android installation support

## Project Structure
```
├── index.html                # PWA Toolkit demo page
├── driver.html              # TimePulse AI driver app (NEW)
├── driver-manifest.json     # Driver app PWA manifest (NEW)
├── page1.html, page2.html   # Demo pages (precached)
├── page3.html               # Demo page (not precached)
├── offline.html             # Offline fallback page
├── assets/
│   ├── app.css             # Demo application styles
│   ├── app.js              # Demo application logic
│   ├── driver-app.js       # Driver app logic (NEW)
│   └── logo.jpg            # Logo image
├── pwa/
│   ├── config.js           # PWA configuration (demo)
│   ├── driver-config.js    # Driver PWA configuration (NEW)
│   ├── pwa.js              # PWA toolkit library
│   ├── manifest.json       # PWA manifest (demo)
│   ├── sw.js               # Service worker
│   └── icons/              # App icons for various platforms
└── server.py               # Python HTTP server (Replit)
```

## Technology Stack
- **Frontend**: Pure HTML5, CSS3, JavaScript (ES6+)
- **UI Frameworks**: 
  - Materialize CSS (demo app)
  - Tailwind CSS (driver app)
- **PWA Toolkit**: JFA PWA Toolkit
- **Maps**: Mapbox GL JS (driver app)
- **Icons**: Font Awesome 6
- **Server**: Python HTTP Server (for Replit hosting)

## TimePulse AI Driver App Features

### 1. **Mandatory PWA Installation**
   - Modal bloqueante obrigatório para dispositivos móveis
   - Instruções específicas para Android/Chrome
   - Instruções específicas para iOS/Safari
   - Botão de instalação automática (quando disponível)
   - Verificação contínua de instalação
   - Recarregamento automático após instalação

### 2. **Authentication System**
   - Login com telefone e senha
   - Cadastro de novos motoristas
   - Armazenamento local de credenciais
   - Proteção de sessão

### 3. **Driver Interface**
   - Mapa interativo com Mapbox
   - Status online/offline
   - Indicador de localização em tempo real
   - Controles de navegação

### 4. **Order Management**
   - Modal de novos pedidos
   - Detalhes completos da entrega
   - Sistema de aceitar/recusar pedidos
   - Cálculo de ganhos estimados
   - Distância e endereços

### 5. **Earnings Dashboard**
   - Saldo disponível
   - Histórico de entregas
   - Ganhos diários e semanais
   - Sistema de solicitação de saque

### 6. **Push Notifications**
   - Notificações de novos pedidos
   - Permissão de notificação automática
   - Integração com PWA Toolkit
   - Suporte para notificações persistentes

## PWA Toolkit Demo Features
1. **Notification Management**
   - Request notification permissions
   - Show browser notifications with custom title/message
   
2. **Caching & Offline Support**
   - Precaching of critical routes
   - Network-first caching strategy
   - Image and static file caching
   - Offline page fallback

3. **Cache Management**
   - Clear browser cache functionality
   - Navigate between cached and non-cached pages

## Configuration
The PWA is configured in `pwa/config.js`:
- App name and version
- Service worker settings
- Cache strategies (network-first for routes)
- Precache routes
- Image, font, and static file caching

## Development
The app runs on a Python HTTP server with:
- Host: `0.0.0.0` (accessible to Replit's proxy)
- Port: `5000` (Replit's standard webview port)
- Cache-Control headers disabled for development

## Testing PWA Features

### Testing the PWA Toolkit Demo (index.html)
1. Open the app in a mobile browser for full PWA experience
2. Test notifications by clicking "Permission to allow Notifications"
3. Navigate to Page 1 and Page 2 (precached pages)
4. Go offline and try accessing the precached pages
5. Try Page 3 to see behavior for non-precached content

### Testing the Driver App (driver.html)
1. **On Mobile Device (Required for full experience)**:
   - Open `/driver.html` on Android Chrome or iOS Safari
   - You will see a mandatory installation modal
   - Follow the instructions to install the app
   - Once installed, close the browser and open from home screen
   - Create an account or login
   - Test order acceptance/rejection
   - Check earnings dashboard

2. **On Desktop** (Installation modal won't show):
   - Open `/driver.html` on desktop browser
   - Create an account and test the interface
   - Map and order features work normally
   - Installation features are mobile-only

3. **Features to Test**:
   - User registration and login
   - Toggle online/offline status
   - Accept/reject simulated orders
   - View earnings and request withdrawal
   - Test map navigation
   - Test notifications (after installation on mobile)

## How to Install as App on Android

1. Open the driver app on Chrome for Android
2. Wait for the installation modal to appear
3. If the "Install Now" button is available, tap it
4. Otherwise, follow the manual instructions:
   - Tap the three dots (⋮) in the top right
   - Tap "Add to Home screen" or "Install app"
   - Confirm by tapping "Add"
5. The app icon will appear on your home screen
6. Close the browser and open the app from the home screen

## How to Install as App on iOS

1. Open the driver app on Safari for iOS
2. Tap the Share button (box with arrow) at the bottom
3. Scroll down and tap "Add to Home Screen"
4. Tap "Add" in the top right corner
5. The app icon will appear on your home screen
6. Close Safari and open the app from the home screen

## Recent Changes
- **2025-11-02**: Sistema de Cálculo de Taxa de Entrega com Mapbox
  - ✅ Criado arquivo `atualizadados.sql` para adicionar campo `delivery_type` à tabela orders
  - ✅ Implementado botão "Calcular Taxa de Entrega" com cálculo manual obrigatório
  - ✅ Adicionada flag `deliveryFeeCalculated` para rastrear se taxa foi calculada
  - ✅ Implementada validação que impede criar pedido sem calcular taxa de entrega
  - ✅ Criado sistema de reset automático da flag quando endereço ou configurações mudam
  - ✅ Modificada função `saveOrder()` para salvar delivery_distance, delivery_duration e delivery_type no banco
  - ✅ Desabilitadas todas as chamadas automáticas a `calculateDeliveryRoute()` - usuário deve clicar no botão
  - ✅ Adicionado indicador visual "Taxa calculada com sucesso!" após cálculo
  - ✅ Corrigido SQL backfill para atualizar TODOS os pedidos de delivery (não apenas os com taxa > 0)
  - ✅ Implementado fluxo completo: preencher → calcular → validar → salvar

- **2025-11-01**: Complete Driver App Redesign & Migration
  - ✅ Migrated from Replit Agent to Replit environment
  - ✅ Activated all 8 environment variables (Supabase, OpenAI, Mapbox, Evolution API, JWT)
  - ✅ Completely redesigned driver-new.html with modern tabbed interface
  - ✅ Implemented display of ALL available orders (not just first one)
  - ✅ Created order cards showing: restaurant name, addresses, distances, delivery fee
  - ✅ Implemented distance calculation from driver device to restaurant using Haversine formula
  - ✅ Created fullscreen responsive modal with Mapbox routes (Point A: restaurant, Point B: delivery)
  - ✅ Added Accept (green) and Reject (red) buttons in modal
  - ✅ Created backend endpoint `/api/driver/orders/available-with-items` to fetch orders with items
  - ✅ Modified endpoint to show ALL orders except those with status "aguardando"
  - ✅ Fixed critical coordinate parsing bug to support PostgreSQL point format `(lon,lat)`
  - ✅ Added Mapbox token endpoint `/api/config/mapbox-token` for secure token delivery
  - ✅ Removed join with customers table to fix relationship errors
  - ✅ Added empty state screen with illustration for completed deliveries

- **2025-11-01**: Initial Replit setup
  - Added Python HTTP server for static file serving
  - Configured workflow to run on port 5000
  - Added cache-control headers for proper browser caching behavior
  - Created .gitignore for Python and Replit files

- **2025-11-01**: Added TimePulse AI Driver App (original)
  - Created driver.html with complete delivery driver interface
  - Implemented mandatory PWA installation for mobile devices
  - Added driver-manifest.json with proper PWA configuration
  - Created driver-config.js for PWA Toolkit integration
  - Developed driver-app.js with full application logic
  - Integrated Mapbox GL JS for interactive maps
  - Implemented user authentication system
  - Added order management with accept/reject functionality
  - Created earnings dashboard with withdrawal system
  - Configured push notifications for new orders
  - Added comprehensive installation instructions for iOS and Android

## License
JFA PWA Toolkit is MIT licensed. See LICENSE file for details.
