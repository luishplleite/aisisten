# TimePulse AI - Delivery Management Platform

## Overview
TimePulse AI is a comprehensive delivery management platform designed for restaurants and food service businesses. The application provides real-time order management, delivery tracking, menu management, and business analytics.

## Project Architecture
- **Frontend**: Static HTML/CSS/JavaScript application
- **Backend**: Supabase integration (requires configuration)
- **Database**: PostgreSQL via Supabase
- **Language**: Portuguese (Brazilian)

## Current Setup
- **Port**: 5000 (Static HTTP server)
- **Host Configuration**: Configured for 0.0.0.0 to work with Replit proxy
- **Server**: Python HTTP server serving static files

## Project Structure
```
/
├── index.html              # Landing page
├── login.html              # Login interface
├── cadastro_restaurante.html # Restaurant registration
├── dashboard.html          # Main dashboard
├── cardapio.html          # Menu management
├── cozinha.html           # Kitchen interface
├── gestao_pedidos.html    # Order management
├── clientes.html          # Customer management
├── bd.sql                 # Database schema
├── css/
│   └── styles.css         # Global styles
├── js/
│   └── config.js          # Configuration and utilities
└── replit.md              # This documentation
```

## Features
- ✅ Real-time order management
- ✅ Delivery tracking and management
- ✅ Menu and product management
- ✅ Customer management
- ✅ Dashboard with statistics
- ✅ Responsive design for all devices

## Setup Requirements
1. **Supabase Configuration**: Update `js/config.js` with actual Supabase credentials
2. **Database**: Import `bd.sql` schema to Supabase project
3. **API Keys**: Configure Supabase URL and anonymous key

## Current Status
- ✅ Static server running on port 5000 with Python 3.11
- ✅ All core HTML pages accessible and functional
- ✅ CSS and JavaScript loading correctly
- ✅ Supabase integration fully configured and working
- ✅ Restaurant registration system functional
- ✅ Email confirmation system integrated
- ✅ Dashboard configuration issues resolved
- ✅ Kitchen page (cozinha.html) configuration issues resolved
- ✅ Orders management page (gestao_pedidos.html) updated with centralized config
- ✅ Menu page (cardapio.html) updated with centralized config
- ✅ Reports page (relatorios.html) fully functional with real Supabase data
- ✅ All charts and analytics loading from database with correct schema
- ⚠️ Some navigation links point to unimplemented pages

## Recent Changes
- 2025-09-02: Initial project import and setup
- 2025-09-02: Created missing CSS and JavaScript files
- 2025-09-02: Configured Python HTTP server workflow
- 2025-09-02: Added restaurant registration page
- 2025-09-02: Integrated Supabase authentication and database
- 2025-09-02: Added Office Integrator API for email confirmations
- 2025-09-02: Enhanced registration form with validation and UX improvements
- 2025-09-02: Fixed dashboard.html configuration issues with Supabase config references
- 2025-09-02: Fixed cozinha.html CORS errors by replacing backend config requests with local config.js
- 2025-09-02: Installed Python 3.11 and reconfigured workflow
- 2025-09-02: Added config.js script inclusion to cozinha.html
- 2025-09-02: Updated gestao_pedidos.html to use centralized configuration system
- 2025-09-02: Updated cardapio.html to use centralized configuration system
- 2025-09-02: **MAJOR UPDATE: Implemented comprehensive instance-based authentication system**
  - Created INSTANCE_MANAGER system in config.js with cookie-based storage (replacing localStorage)
  - Added automatic environment detection for Replit compatibility
  - Implemented secure instance authentication with restaurant data filtering
  - Updated all HTML pages (login, dashboard, gestao_pedidos, cardapio, cozinha) to use instance filtering
  - All data queries now filtered by connected restaurant instance for multi-tenant security
- 2025-09-03: **Created comprehensive customer management system (clientes.html)**
  - Implemented complete customer CRUD operations (Create, Read, Update, Delete)
  - Added customer search and filtering functionality (by name, phone, email, city, registration period)
  - Created consumption reports with detailed customer analytics (total orders, spending, average ticket)
  - Added export functionality for customer data and reports
  - Integrated with customers table from database schema with all relevant fields
  - Used identical layout and CSS structure as cozinha.html for consistency
  - Implemented real-time statistics dashboard for customer metrics
- 2025-09-04: **Major reports system overhaul (relatorios.html)**
  - Fixed all database schema issues (total_amount → total, missing foreign keys)
  - Implemented real data loading for all charts: Top 5 Clientes, Composição Categoria, Vendas por Horário
  - Added proper JOIN queries to handle missing foreign key constraints between order_items and orders
  - Created optimized layout with improved spacing and mobile responsiveness
  - Integrated AI insights and social media assistant in organized grid layout
  - All metrics now calculated from real orders, customers, and order_items data

## Development Notes
- The application uses embedded CSS in HTML files for styling
- JavaScript functionality is minimal without Supabase configuration
- Database schema is comprehensive but requires Supabase setup
- All text and interfaces are in Portuguese (Brazilian)

## Next Steps
1. Configure Supabase credentials for full functionality
2. Implement missing pages referenced in navigation
3. Set up authentication and user management
4. Configure payment integrations (Asaas mentioned in schema)