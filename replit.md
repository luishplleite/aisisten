# Overview

TimePulse AI is a comprehensive delivery management platform for restaurants that provides real-time order management, kitchen operations, customer service, and business analytics. The platform features an AI-powered virtual assistant named "Ana" for customer interactions, integrated WhatsApp messaging, and a complete restaurant management dashboard with multi-user support including admin, restaurant owners, kitchen staff, and delivery personnel.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

**September 19, 2025**
- Successfully imported TimePulse AI project from GitHub
- Installed all Node.js dependencies (express, supabase, openai, etc.)
- Configured Express server to run on port 5000 with 0.0.0.0 host for Replit compatibility
- Set up workflow "TimePulse AI Server" using `npm start`
- ✅ **ALL API KEYS CONFIGURED**: Supabase, OpenAI, Mapbox, Evolution API
- Verified all services are enabled and functioning correctly
- Configured deployment for autoscale production deployment
- Verified application loads correctly with landing page displaying features

**Project Import Status: ✅ COMPLETED**  
**API Integration Status: ✅ FULLY ACTIVE**

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