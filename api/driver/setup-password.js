/**
 * Password Setup Endpoint for Existing Drivers
 * 
 * This endpoint allows existing deliverers (who don't have passwords yet)
 * to set up their password for the first time.
 * 
 * This is part of the migration strategy to support existing deliverers
 * when adding the driver mobile app authentication.
 */

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

let supabaseUrl = process.env.SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (supabaseUrl && supabaseUrl.startsWith('eyJ') && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY.startsWith('https://')) {
    const temp = supabaseUrl;
    supabaseUrl = process.env.SUPABASE_ANON_KEY;
    supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || temp;
}

// Validate required environment variables
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'timepulse_admin_secret_2025' || JWT_SECRET === 'timepulse_driver_secret_2025') {
    console.error('❌ CRITICAL: JWT_SECRET environment variable must be set to a strong secret for password setup endpoint');
    throw new Error('JWT_SECRET must be configured with a strong secret');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const jwt = require('jsonwebtoken');
const SALT_ROUNDS = 10;

// Admin authentication middleware
async function authenticateAdmin(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Autenticação de administrador requerida' });
        }
        
        const token = authHeader.substring(7);
        
        // Verify admin JWT - NO FALLBACK, use validated JWT_SECRET only
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            
            if (decoded.role !== 'admin') {
                return res.status(403).json({ error: 'Apenas administradores podem configurar senhas' });
            }
            
            req.admin = decoded;
            next();
        } catch (jwtError) {
            return res.status(401).json({ error: 'Token de administrador inválido ou expirado' });
        }
    } catch (error) {
        console.error('❌ Erro na autenticação admin:', error);
        res.status(500).json({ error: 'Erro interno de autenticação' });
    }
}

/**
 * POST /api/driver/auth/setup-password
 * 
 * ADMIN-ONLY: Allows administrators to set initial passwords for existing deliverers
 * This is a migration/setup endpoint that requires admin authentication
 * 
 * SECURITY: This endpoint is intentionally admin-only to prevent account takeover
 * Future enhancement: Could use SMS OTP for self-service password setup
 */
router.post('/setup-password', authenticateAdmin, async (req, res) => {
    try {
        const { phone, password, deliverer_id } = req.body;

        if ((!phone && !deliverer_id) || !password) {
            return res.status(400).json({ 
                error: 'ID/telefone do entregador e senha são obrigatórios' 
            });
        }

        // Validate password strength
        if (password.length < 6) {
            return res.status(400).json({
                error: 'A senha deve ter no mínimo 6 caracteres'
            });
        }

        // Find deliverer by ID or phone
        let query = supabase.from('deliverers').select('*');
        
        if (deliverer_id) {
            query = query.eq('id', deliverer_id);
        } else {
            query = query.eq('phone', phone);
        }

        const { data: deliverer, error: delivererError } = await query.single();

        if (delivererError || !deliverer) {
            return res.status(404).json({ 
                error: 'Entregador não encontrado' 
            });
        }

        // Check if password already exists
        const { data: existing } = await supabase
            .from('driver_credentials')
            .select('id')
            .eq('deliverer_id', deliverer.id)
            .single();

        if (existing) {
            return res.status(400).json({ 
                error: 'Senha já configurada. Use o login normal.' 
            });
        }

        // Hash password and create credentials
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        const { error: credError } = await supabase
            .from('driver_credentials')
            .insert({
                deliverer_id: deliverer.id,
                password_hash: passwordHash
            });

        if (credError) {
            console.error('❌ Erro ao configurar senha:', credError);
            return res.status(500).json({ error: 'Erro ao configurar senha' });
        }

        res.json({
            success: true,
            message: 'Senha configurada com sucesso! Agora você pode fazer login.',
            deliverer: {
                id: deliverer.id,
                name: deliverer.name,
                phone: deliverer.phone
            }
        });

    } catch (error) {
        console.error('❌ Erro na configuração de senha:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

module.exports = router;
