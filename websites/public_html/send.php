<?php
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Метод не разрешен']);
    exit;
}

$name = isset($_POST['name']) ? trim($_POST['name']) : '';
$email = isset($_POST['email']) ? trim($_POST['email']) : '';
$message = isset($_POST['message']) ? trim($_POST['message']) : '';

$errors = [];

if (empty($name)) {
    $errors[] = 'Имя обязательно для заполнения';
}

if (empty($email)) {
    $errors[] = 'Email обязателен для заполнения';
} elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $errors[] = 'Некорректный email адрес';
}

if (empty($message)) {
    $errors[] = 'Сообщение обязательно для заполнения';
}

if (!empty($errors)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => implode(', ', $errors)]);
    exit;
}

$to = 'sobolnikov.roma@mail.ru';
$subject = 'Новое сообщение с сайта dfead.website';

$emailBody = "Новое сообщение с сайта\n\n";
$emailBody .= "Имя: " . htmlspecialchars($name) . "\n";
$emailBody .= "Email: " . htmlspecialchars($email) . "\n";
$emailBody .= "Сообщение:\n" . htmlspecialchars($message) . "\n";
$emailBody .= "\n---\nДата: " . date('d.m.Y H:i:s');

$headers = "From: noreply@dfead.website\r\n";
$headers .= "Reply-To: " . htmlspecialchars($email) . "\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
$headers .= "X-Mailer: PHP/" . phpversion();

$logFile = __DIR__ . '/messages.txt';
$logEntry = date('Y-m-d H:i:s') . " | " . htmlspecialchars($name) . " | " . htmlspecialchars($email) . " | " . htmlspecialchars($message) . "\n";
file_put_contents($logFile, $logEntry, FILE_APPEND | LOCK_EX);

$mailSent = @mail($to, $subject, $emailBody, $headers);

if ($mailSent) {
    echo json_encode([
        'success' => true, 
        'message' => 'Сообщение успешно отправлено! Я свяжусь с вами в ближайшее время.'
    ]);
} else {
    echo json_encode([
        'success' => true, 
        'message' => 'Сообщение получено! Я свяжусь с вами в ближайшее время.'
    ]);
}
?>

