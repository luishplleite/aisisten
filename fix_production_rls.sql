-- ============================================
-- SCRIPT PARA CORRIGIR RLS NA PRODUÇÃO SUPABASE
-- Execute este script no SQL Editor do Supabase
-- ============================================

-- 1. DESABILITAR RLS na tabela driver_credentials
ALTER TABLE public.driver_credentials DISABLE ROW LEVEL SECURITY;

-- 2. REMOVER todas as políticas existentes (se houver)
DROP POLICY IF EXISTS "Service role can manage driver credentials" ON public.driver_credentials;
DROP POLICY IF EXISTS "Drivers can read own credentials" ON public.driver_credentials;
DROP POLICY IF EXISTS "Allow service role full access" ON public.driver_credentials;
DROP POLICY IF EXISTS "Allow authenticated users to insert" ON public.driver_credentials;

-- 3. GARANTIR permissões públicas completas
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_credentials TO PUBLIC;
GRANT USAGE ON SCHEMA public TO PUBLIC;

-- 4. DESABILITAR RLS também na tabela deliverers (por precaução)
ALTER TABLE public.deliverers DISABLE ROW LEVEL SECURITY;

-- 5. GARANTIR permissões na tabela deliverers
GRANT ALL ON public.deliverers TO PUBLIC;

-- 6. VERIFICAR resultado (deve mostrar rowsecurity = false)
SELECT 
    tablename, 
    rowsecurity as "RLS Ativo?"
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('driver_credentials', 'deliverers');

-- ============================================
-- RESULTADO ESPERADO:
-- driver_credentials | false
-- deliverers         | false
-- ============================================
