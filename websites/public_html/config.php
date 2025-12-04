<?php
declare(strict_types=1);

const PORTFOLIO_DATA_FILE = __DIR__ . '/data/portfolio.json';
const ADMIN_PANEL_QUERY = 'admin';
const ADMIN_SESSION_KEY = 'viweb_admin_authenticated';
const ADMIN_CONFIG_LOCAL = __DIR__ . '/config.local.php';
const ADMIN_DEFAULT_PEPPER = 'viweb-pepper-2024';

function getAdminConfig(): array
{
    static $config = null;

    if ($config !== null) {
        return $config;
    }

    $config = [
        'username' => 'roma',
        'password_hash' => null,
        'password_plain' => null,
        'pepper' => ADMIN_DEFAULT_PEPPER,
        'max_attempts' => 5,
        'lock_minutes' => 10,
    ];

    if (file_exists(ADMIN_CONFIG_LOCAL)) {
        $local = require ADMIN_CONFIG_LOCAL;
        if (is_array($local)) {
            $config = array_merge(
                $config,
                array_filter(
                    $local,
                    static fn($value) => $value !== null
                )
            );
        }
    }

    if (empty($config['username'])) {
        throw new RuntimeException('Не настроен логин администратора.');
    }

    return $config;
}

function getAdminUsername(): string
{
    $config = getAdminConfig();

    return (string)$config['username'];
}

function getAdminPepper(): string
{
    $config = getAdminConfig();

    return (string)($config['pepper'] ?? ADMIN_DEFAULT_PEPPER);
}

function pepperPassword(string $password): string
{
    return hash_hmac('sha512', $password, getAdminPepper());
}

function getAdminPasswordHash(): string
{
    static $passwordHash = null;

    if ($passwordHash !== null) {
        return $passwordHash;
    }

    $config = getAdminConfig();

    if (!empty($config['password_hash'])) {
        $passwordHash = (string)$config['password_hash'];

        return $passwordHash;
    }

    if (!empty($config['password_plain'])) {
        $passwordHash = password_hash(
            pepperPassword((string)$config['password_plain']),
            PASSWORD_DEFAULT
        );

        return $passwordHash;
    }

    throw new RuntimeException('Пароль администратора не настроен. Укажите password_hash в config.local.php');
}

function isAdminPasswordUsingPlainFallback(): bool
{
    $config = getAdminConfig();

    return empty($config['password_hash']) && !empty($config['password_plain']);
}

function getAdminRateLimits(): array
{
    $config = getAdminConfig();

    return [
        'max_attempts' => max(3, (int)($config['max_attempts'] ?? 5)),
        'lock_minutes' => max(1, (int)($config['lock_minutes'] ?? 10)),
    ];
}

function verifyAdminPassword(string $password): bool
{
    return password_verify(pepperPassword($password), getAdminPasswordHash());
}

function loadPortfolioItems(): array
{
    if (!file_exists(PORTFOLIO_DATA_FILE)) {
        return [];
    }

    $json = file_get_contents(PORTFOLIO_DATA_FILE);
    if ($json === false) {
        return [];
    }

    $data = json_decode($json, true);

    return is_array($data) ? $data : [];
}

function savePortfolioItems(array $items): bool
{
    $payload = json_encode(
        array_values($items),
        JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );

    if ($payload === false) {
        return false;
    }

    return file_put_contents(PORTFOLIO_DATA_FILE, $payload, LOCK_EX) !== false;
}

