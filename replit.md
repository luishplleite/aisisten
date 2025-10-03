# Overview

TimePulse AI is a comprehensive delivery management platform for restaurants that provides real-time order management, kitchen operations, customer service, and business analytics. The platform features an AI-powered virtual assistant named "Ana" for customer interactions, integrated WhatsApp messaging, and a complete restaurant management dashboard with multi-user support including admin, restaurant owners, kitchen staff, and delivery personnel.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

**October 3, 2025 - Replit Environment Setup Complete:**
- ✅ **GitHub Import**: Successfully imported TimePulse AI from GitHub to fresh Replit environment
- ✅ **Dependencies Installed**: All Node.js packages installed via npm (express, supabase, openai, etc.)
- ✅ **Server Running**: Express server running on port 5000 with 0.0.0.0 host for Replit proxy compatibility
- ✅ **Environment Variables**: All API keys configured (Supabase, OpenAI, Mapbox, Evolution API)
- ✅ **Status Endpoint Fixed**: Updated /api/status to recognize alternative env var names (EVOLUTION_API_URL, MAPBOX_TOKEN)
- ✅ **All Services Connected**: Supabase, OpenAI, Evolution API, and Mapbox all reporting connected status
- ✅ **Deployment Configured**: Autoscale deployment setup for production ready
- ✅ **Frontend Verified**: Landing page loads correctly with full UI functionality

**October 3, 2025 - WhatsApp Subscription Access Fix:**
- ✅ **Subscription Logic Fixed**: WhatsApp now correctly unlocks when status is 'active' OR 'trial' (line 5818)
- ✅ **Button ID Consistency**: Fixed event listener to use correct button ID 'configure-whatsapp' (line 1907)
- ✅ **Function Reference Fixed**: Corrected click handler to call 'openWhatsAppModal' function (line 1909)
- ✅ **Access Control Working**: Active subscriptions now have full WhatsApp configuration access
- ✅ **Trial Support Restored**: Trial users can now configure WhatsApp during trial period

**October 3, 2025 - Order Management Fixes:**
- ✅ **JavaScript Error Fixed**: Resolved "deliverersData already declared" error in gestao_pedidos.html
- ✅ **Order Loading Fixed**: Orders now load and display correctly on the management page
- ✅ **Authentication Enhancement**: Expanded getInstanceData() to read from localStorage and sessionStorage
- ✅ **Mock Data Removed**: Removed all mock data logic - now loads exclusively from Supabase tables (orders & order_items)
- ✅ **Real-time Database**: System now pulls 19 orders and 23 items directly from Supabase

**September 29, 2025**
- ✅ **FRESH PROJECT IMPORT COMPLETED**: Successfully imported TimePulse AI from GitHub to Replit
- ✅ **DEPENDENCIES**: All Node.js packages installed (express, supabase, openai, etc.)
- ✅ **SERVER CONFIGURATION**: Running on port 5000 with 0.0.0.0 host for Replit compatibility
- ✅ **WORKFLOW SETUP**: "TimePulse AI Server" configured and running via `npm start`
- ✅ **ENVIRONMENT VARIABLES**: All API keys configured (Supabase, OpenAI, Mapbox, Evolution API)
- ✅ **REAL CONNECTIVITY CHECKS**: Replaced mocked status with live service verification
- ✅ **PRODUCTION DEPLOYMENT**: Autoscale deployment configured for production
- ✅ **FRONTEND WORKING**: Landing page loads correctly with full responsiveness
- ✅ **SECURITY & CORS**: All middleware configured for Replit proxy environment
- ✅ **HEALTH MONITORING**: Real-time status endpoint with connectivity verification

**September 20, 2025 - Phone Search System Optimization:**
- ✅ **Multi-Format Phone Search**: Brazilian phone numbers now support +5513991292600, 5513991292600, 13991292600 formats
- ✅ **Enhanced Privacy Protection**: Universal phone masking system for logs (maskPhoneForLog function)
- ✅ **Multi-Tenant Security**: Mandatory restaurant_id filtering for customer data isolation
- ✅ **Performance Optimization**: Single optimized query using .in() method instead of sequential searches
- ✅ **Robust Fallback System**: LIKE search for edge cases with constrained digit matching
- ✅ **Production-Ready Security**: Comprehensive error handling and PII protection

**Project Import Status: ✅ COMPLETED**  
**API Integration Status: ✅ FULLY ACTIVE**  
**Phone Search System: ✅ PRODUCTION-READY**  
**Deployment Status: ✅ READY FOR PRODUCTION**

# System Architecture

## Frontend Architecture
- **Multi-page Application (MPA)**: Traditional HTML pages with JavaScript modules for each major feature
- **Theme System**: CSS custom properties for consistent styling with customizable primary colors
- **Progressive Enhancement**: Core functionality works without JavaScript, enhanced with client-side features
- **Responsive Design**: Mobile-first approach using CSS Grid and Flexbox
- **Security-First**: Client-side configuration management with secure API key handling

## Backend Architecture
- **Express.js Server**: RESTful API with middleware for security (Helmet, CORS)
- **Authentication Strategy**: JWT-based authentication with secure cookie management
- **Instance Management**: Multi-tenant architecture supporting multiple restaurant instances
- **Real-time Features**: WebSocket-like functionality for live order updates and kitchen management

## Data Storage Solutions
- **Supabase Integration**: PostgreSQL database with real-time subscriptions
- **Session Management**: Encrypted cookies for user sessions and instance data
- **Configuration Storage**: Environment-based configuration with fallbacks for development

## Authentication and Authorization
- **Role-based Access Control**: Admin, restaurant owner, kitchen staff, and delivery personnel roles
- **Secure Token Management**: JWT tokens with automatic refresh and secure storage
- **Session Persistence**: Instance-based sessions allowing multiple restaurant management
- **CSRF Protection**: Form security with token validation

## External Dependencies

### Database and Backend Services
- **Supabase**: Primary database and real-time functionality provider
- **PostgreSQL**: Underlying database engine through Supabase

### AI and Communication Services
- **OpenAI GPT**: Powers the "Ana" virtual assistant for customer interactions
- **WhatsApp Integration**: Evolution API for WhatsApp Business messaging
- **QR Code Generation**: Customer-facing QR codes for menu access and ordering

### Maps and Location Services
- **Mapbox**: Delivery tracking and route optimization for order management
- **Geolocation APIs**: Address validation and delivery zone management

### Development and Deployment Tools
- **Chart.js**: Business analytics and reporting visualizations
- **Font Awesome**: Consistent iconography across the platform
- **Google Fonts**: Typography using Inter font family

### Security and Monitoring
- **Helmet.js**: HTTP security headers and protection
- **CORS**: Cross-origin resource sharing configuration
- **JWT**: JSON Web Token implementation for secure authentication

### Trial and Subscription Management
- **Built-in Trial System**: 7-day free trial with automatic limitations
- **Subscription Tracking**: Integration-ready for payment processors
- **Usage Monitoring**: Feature limitation enforcement based on subscription tier