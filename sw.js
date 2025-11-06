// ===================================================================
// TIMEPULSE AI - SERVICE WORKER AVANÇADO
// Baseado na documentação PWA avançada
// ===================================================================

const CACHE_VERSION = 'v2.1.1';
const CACHE_STATIC = `timepulse-static-${CACHE_VERSION}`;
const CACHE_DYNAMIC = `timepulse-dynamic-${CACHE_VERSION}`;
const CACHE_IMAGES = `timepulse-images-${CACHE_VERSION}`;
const MAX_CACHE_SIZE = 50; // Máximo de itens no cache dinâmico
const MAX_IMAGE_CACHE_AGE = 30 * 24 * 60 * 60 * 1000; // 30 dias em ms

// Recursos estáticos para Cache First (App Shell)
const STATIC_ASSETS = [
  '/driver.html',
  '/assets/driver-app.js',
  '/pwa/driver-config.js',
  '/pwa/pwa.js',
  '/driver-manifest.json',
  '/pwa/icons/android/android-launchericon-192-192.png',
  '/pwa/icons/android/android-launchericon-512-512.png',
  '/offline.html'
];

// ===================================================================
// INSTALAÇÃO - PRÉ-CACHE DOS RECURSOS ESTÁTICOS
// ===================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] 📦 Instalando Service Worker...');
  
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => {
        console.log('[SW] ✅ Cache estático aberto');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] ✅ Recursos estáticos cacheados');
        return self.skipWaiting(); // Ativar imediatamente
      })
      .catch((error) => {
        console.error('[SW] ❌ Erro ao cachear recursos:', error);
      })
  );
});

// ===================================================================
// ATIVAÇÃO - LIMPEZA DE CACHES ANTIGOS
// ===================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] 🔄 Ativando Service Worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Deletar caches que não são da versão atual
            if (!cacheName.includes(CACHE_VERSION)) {
              console.log('[SW] 🗑️ Deletando cache antigo:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] ✅ Service Worker ativado');
        return self.clients.claim(); // Assumir controle imediatamente
      })
  );
});

// ===================================================================
// ESTRATÉGIAS DE CACHE AVANÇADAS
// ===================================================================

// Cache First - Para recursos estáticos (CSS, JS, App Shell)
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(request);
  
  if (cached) {
    console.log('[SW] 📦 Cache First HIT:', request.url);
    return cached;
  }
  
  console.log('[SW] 🌐 Cache First MISS, buscando na rede:', request.url);
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}

// Network First - Para conteúdo dinâmico (HTML, APIs)
async function networkFirst(request) {
  const cache = await caches.open(CACHE_DYNAMIC);
  
  try {
    console.log('[SW] 🌐 Network First - Tentando rede:', request.url);
    const response = await fetch(request);
    
    // Cachear resposta bem-sucedida
    if (response && response.status === 200) {
      cache.put(request, response.clone());
      await limitCacheSize(CACHE_DYNAMIC, MAX_CACHE_SIZE);
    }
    
    return response;
  } catch (error) {
    console.log('[SW] 📦 Network First - Falha na rede, usando cache:', request.url);
    const cached = await cache.match(request);
    
    if (cached) {
      return cached;
    }
    
    // Se for documento HTML, retornar página offline
    if (request.destination === 'document') {
      return cache.match('/driver.html');
    }
    
    throw error;
  }
}

// Stale-While-Revalidate - Para imagens (mostra cache imediatamente e atualiza em background)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_IMAGES);
  const cached = await cache.match(request);
  
  // Buscar na rede em paralelo
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
        cleanOldImageCache(); // Limpar imagens antigas
      }
      return response;
    })
    .catch((error) => {
      console.log('[SW] ⚠️ Falha na rede para:', request.url);
      // Se falhar e cache existir, retornar cache
      if (cached) {
        return cached;
      }
      // Se não há cache nem rede, retornar resposta 404 ou imagem placeholder
      return new Response('', { 
        status: 404, 
        statusText: 'Recurso não disponível offline' 
      });
    });
  
  // Retornar cache imediatamente se disponível, senão aguardar rede
  return cached || fetchPromise;
}

// ===================================================================
// FUNÇÕES AUXILIARES DE CACHE
// ===================================================================

// Limitar tamanho do cache
async function limitCacheSize(cacheName, maxSize) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > maxSize) {
    console.log(`[SW] 🗑️ Limpando cache ${cacheName} (${keys.length}/${maxSize})`);
    await cache.delete(keys[0]); // Remove o mais antigo (FIFO)
    await limitCacheSize(cacheName, maxSize); // Recursivo
  }
}

// Limpar imagens antigas (> 30 dias)
async function cleanOldImageCache() {
  const cache = await caches.open(CACHE_IMAGES);
  const requests = await cache.keys();
  const now = Date.now();
  
  for (const request of requests) {
    const response = await cache.match(request);
    const dateHeader = response.headers.get('date');
    
    if (dateHeader) {
      const age = now - new Date(dateHeader).getTime();
      if (age > MAX_IMAGE_CACHE_AGE) {
        console.log('[SW] 🗑️ Removendo imagem antiga:', request.url);
        await cache.delete(request);
      }
    }
  }
}

// ===================================================================
// INTERCEPTAÇÃO DE REQUISIÇÕES (FETCH)
// ===================================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Ignorar requisições não-GET
  if (request.method !== 'GET') {
    return;
  }
  
  // Ignorar requisições de analytics, POSTs, etc
  if (url.pathname.includes('/api/analytics') || 
      url.pathname.includes('/api/track')) {
    return; // Network Only
  }
  
  // ===================================================================
  // ROTEAMENTO DE ESTRATÉGIAS
  // ===================================================================
  
  // 1. IMAGENS - Stale-While-Revalidate
  if (request.destination === 'image' || 
      url.pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/i)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  
  // 2. RECURSOS ESTÁTICOS - Cache First (CSS, JS, Fonts)
  if (STATIC_ASSETS.some(asset => url.pathname.includes(asset)) ||
      url.pathname.match(/\.(css|js|woff|woff2|ttf|eot)$/i) ||
      url.hostname === 'cdn.tailwindcss.com' ||
      url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(request));
    return;
  }
  
  // 3. APIs E HTML - Network First
  if (url.pathname.startsWith('/api/') || 
      request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }
  
  // 4. MAPBOX - Stale-While-Revalidate (atualiza em background)
  if (url.hostname.includes('mapbox')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  
  // 5. DEFAULT - Network First
  event.respondWith(networkFirst(request));
});

// ===================================================================
// PUSH NOTIFICATIONS AVANÇADAS
// ===================================================================
self.addEventListener('push', (event) => {
  console.log('[SW] 📬 Push notification recebida');
  
  let data = { title: 'TimePulse AI', body: 'Você tem uma nova atualização' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }
  
  const title = data.title || 'TimePulse AI - Entregador';
  const options = {
    body: data.body || 'Novo pedido disponível!',
    icon: '/img/icon-192x192.png',
    badge: '/img/icon-72x72.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'timepulse-notification',
    requireInteraction: true,
    data: {
      url: data.url || '/driver.html',
      timestamp: Date.now()
    },
    actions: [
      { action: 'open', title: 'Abrir', icon: '/img/icon-72x72.png' },
      { action: 'close', title: 'Dispensar', icon: '/img/icon-72x72.png' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Clique em notificação
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] 🔔 Notificação clicada:', event.action);
  event.notification.close();
  
  if (event.action === 'close') {
    return; // Apenas fechar
  }
  
  // Abrir ou focar na janela do app
  const urlToOpen = event.notification.data?.url || '/driver.html';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Se já existe uma janela aberta, focar nela
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // Senão, abrir nova janela
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// ===================================================================
// BACKGROUND SYNC - SINCRONIZAÇÃO EM SEGUNDO PLANO
// ===================================================================
self.addEventListener('sync', (event) => {
  console.log('[SW] 🔄 Background Sync disparado:', event.tag);
  
  if (event.tag === 'sync-pending-data') {
    event.waitUntil(syncPendingData());
  }
});

// Função para sincronizar dados pendentes
async function syncPendingData() {
  console.log('[SW] 📤 Sincronizando dados pendentes...');
  
  try {
    // Aqui você pode buscar dados do IndexedDB e enviar para o servidor
    // Exemplo: buscar pedidos/updates que falharam quando offline
    
    // const db = await openIndexedDB();
    // const pendingItems = await db.getAll('pending');
    // for (const item of pendingItems) {
    //   await fetch('/api/sync', { method: 'POST', body: JSON.stringify(item) });
    //   await db.delete('pending', item.id);
    // }
    
    console.log('[SW] ✅ Sincronização completa');
    return Promise.resolve();
  } catch (error) {
    console.error('[SW] ❌ Erro na sincronização:', error);
    return Promise.reject(error);
  }
}

// ===================================================================
// MENSAGENS DO CLIENTE
// ===================================================================
self.addEventListener('message', (event) => {
  console.log('[SW] 💬 Mensagem recebida:', event.data);
  
  if (event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data.action === 'clearCache') {
    event.waitUntil(
      caches.keys().then((names) => {
        return Promise.all(names.map(name => caches.delete(name)));
      })
    );
  }
});

console.log('[SW] ✅ Service Worker carregado - Versão:', CACHE_VERSION);
