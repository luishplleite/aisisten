-- =====================================================
-- PERMISSÕES PARA TABELA subcontas_asass
-- =====================================================
-- Este arquivo configura as permissões de acesso para a tabela de subcontas
-- Executar este SQL no Editor SQL do Supabase

-- 1. Habilitar Row Level Security (RLS) na tabela
ALTER TABLE public.subcontas_asass ENABLE ROW LEVEL SECURITY;

-- 2. Remover políticas existentes (se houver)
DROP POLICY IF EXISTS "Permitir leitura pública para login" ON public.subcontas_asass;
DROP POLICY IF EXISTS "Permitir select para autenticação" ON public.subcontas_asass;
DROP POLICY IF EXISTS "Permitir acesso service_role" ON public.subcontas_asass;

-- 3. Criar política para permitir SELECT público (necessário para login)
-- OPÇÃO 1: Acesso público de leitura (menos seguro, mas funciona com cliente)
CREATE POLICY "Permitir leitura pública para login"
ON public.subcontas_asass
FOR SELECT
TO public
USING (true);

-- 4. Criar política para INSERT (apenas service_role)
CREATE POLICY "Permitir insert apenas service_role"
ON public.subcontas_asass
FOR INSERT
TO service_role
WITH CHECK (true);

-- 5. Criar política para UPDATE (apenas service_role)
CREATE POLICY "Permitir update apenas service_role"
ON public.subcontas_asass
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

-- 6. Criar política para DELETE (apenas service_role)
CREATE POLICY "Permitir delete apenas service_role"
ON public.subcontas_asass
FOR DELETE
TO service_role
USING (true);

-- =====================================================
-- ALTERNATIVA MAIS SEGURA (comentado)
-- =====================================================
-- Se preferir uma abordagem mais segura, comente a política pública acima
-- e descomente a política abaixo. Isso exigirá usar o endpoint backend
-- para autenticação ao invés de consulta direta do cliente.

-- DROP POLICY IF EXISTS "Permitir leitura pública para login" ON public.subcontas_asass;
-- 
-- CREATE POLICY "Acesso apenas via service_role"
-- ON public.subcontas_asass
-- FOR SELECT
-- TO service_role
-- USING (true);

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================
-- Execute este comando para verificar as políticas ativas:
-- SELECT * FROM pg_policies WHERE tablename = 'subcontas_asass';

-- =====================================================
-- NOTAS DE SEGURANÇA
-- =====================================================
-- IMPORTANTE: A política de SELECT público permite que qualquer pessoa
-- consulte a tabela subcontas_asass. Isso é necessário para o login
-- funcionar via cliente browser, MAS expõe os dados.
--
-- RECOMENDAÇÃO: Use o endpoint backend /api/auth/revendedor/login
-- que já foi implementado e usa service_role (bypassa RLS de forma segura)
-- Para usar o endpoint backend, modifique loginrevenda.html para fazer
-- POST para /api/auth/revendedor/login ao invés de consultar diretamente.
