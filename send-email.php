<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    $to = $input['to'] ?? '';
    $subject = $input['subject'] ?? 'Bem-vindo ao TimePulse AI';
    $htmlContent = $input['html'] ?? '';
    
    if (empty($to) || empty($htmlContent)) {
        http_response_code(400);
        echo json_encode(['error' => 'Email e conteúdo são obrigatórios']);
        exit;
    }
    
    // Headers para email HTML
    $headers = "MIME-Version: 1.0" . "\r\n";
    $headers .= "Content-type:text/html;charset=UTF-8" . "\r\n";
    $headers .= "From: TimePulseAI <noreply@timepulseai.com.br>" . "\r\n";
    $headers .= "Reply-To: contato@timepulseai.com.br" . "\r\n";
    $headers .= "Return-Path: noreply@timepulseai.com.br" . "\r\n";
    
    // Tentar enviar o email
    if (mail($to, $subject, $htmlContent, $headers)) {
        echo json_encode([
            'success' => true,
            'message' => 'Email enviado com sucesso para ' . $to
        ]);
    } else {
        http_response_code(500);
        echo json_encode([
            'error' => 'Falha ao enviar email'
        ]);
    }
} else {
    http_response_code(405);
    echo json_encode(['error' => 'Método não permitido']);
}
?>