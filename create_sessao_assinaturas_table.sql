-- Criar tabela sessao_assinaturas no Supabase
-- Execute este script no SQL Editor do Supabase

CREATE TABLE IF NOT EXISTS public.sessao_assinaturas (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  plano text NOT NULL,
  id_restaurante text,
  invoiceNumber text,
  price text,
  ip_real text,
  id_pagamento text,
  data_pagamento text,
  status text,
  CONSTRAINT sessao_assinaturas_pkey PRIMARY KEY (id)
);

-- Adicionar índice para melhorar performance das consultas por id_restaurante
CREATE INDEX IF NOT EXISTS idx_sessao_assinaturas_id_restaurante 
ON public.sessao_assinaturas(id_restaurante);

-- Adicionar índice para ordenação por data_pagamento
CREATE INDEX IF NOT EXISTS idx_sessao_assinaturas_data_pagamento 
ON public.sessao_assinaturas(data_pagamento DESC);

-- Exemplo de inserção de dados (ajuste conforme necessário)
-- INSERT INTO public.sessao_assinaturas (plano, id_restaurante, invoiceNumber, price, ip_real, id_pagamento, data_pagamento, status) 
-- VALUES ('basic', '1592e22a-e641-42ed-9e20-00f200f20274', 'pay_b8ea8yd2e9gnawc0', '49.99', '45.4.24.87', '00020101021226820014br.gov.bcb.pix2560pix-h.asaas.com/qr/cobv/...', '2025-10-15T08:08:52.687-03:00', 'Pago');
