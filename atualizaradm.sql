-- =====================================================
-- SCRIPT DE ATUALIZAÇÃO DO ADMINISTRADOR GERAL
-- TimePulse AI - Sistema de Gestão
-- =====================================================

-- Criar tabela de administradores da plataforma (se não existir)
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email character varying NOT NULL UNIQUE,
  name character varying,
  asaas_api text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT platform_admins_pkey PRIMARY KEY (id)
);

-- Inserir ou atualizar o administrador principal
INSERT INTO public.platform_admins (email, name, updated_at)
VALUES ('luishplleite@gmail.com', 'Luis Henrique Leite', now())
ON CONFLICT (email) 
DO UPDATE SET 
  name = EXCLUDED.name,
  updated_at = now();

-- Comentários sobre a tabela
COMMENT ON TABLE public.platform_admins IS 'Tabela para vincular dados dos administradores da plataforma';
COMMENT ON COLUMN public.platform_admins.email IS 'Email único do administrador da plataforma';
COMMENT ON COLUMN public.platform_admins.name IS 'Nome do administrador';
COMMENT ON COLUMN public.platform_admins.asaas_api IS 'Chave de API do Asaas para o administrador da plataforma';
COMMENT ON COLUMN public.platform_admins.created_at IS 'Data de criação do registro';
COMMENT ON COLUMN public.platform_admins.updated_at IS 'Data da última atualização';

-- Verificar os administradores cadastrados
SELECT 
  id,
  email,
  name,
  CASE 
    WHEN asaas_api IS NOT NULL AND asaas_api != '' THEN 'Configurado'
    ELSE 'Não configurado'
  END as asaas_status,
  created_at,
  updated_at
FROM public.platform_admins
ORDER BY created_at DESC;
