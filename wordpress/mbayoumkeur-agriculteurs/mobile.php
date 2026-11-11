<?php
/**
 * Mbayoumkeur – Sur téléphone, les agriculteurs sont dirigés vers l'application (chargé par ../mbayoumkeur-agriculteurs.php).
 *
 *  1. Connexion à WordPress depuis un téléphone : l'agriculteur arrive directement sur l'application
 *     (sauf s'il demandait expressément une page précise de l'administration).
 *  2. Liste « Mes plantes » de l'administration ouverte sur téléphone : redirigée vers l'application.
 *     Échappatoire : ajouter &classique=1 à l'adresse pour rester sur la version classique.
 *  3. Page de connexion et autres pages de l'administration : un message invite à utiliser l'application.
 *
 * Fichier séparé de core.php : une erreur ici ne peut pas désactiver le rôle ni la confidentialité des producteurs.
 * Adresse de l'application modifiable dans wp-config.php : define('MBK_APP_URL', 'https://…/agriculteur');
 */
if (!defined('ABSPATH')) exit;
if (!function_exists('mbk_is_farmer') || !defined('MBK_ROLE') || !defined('MBK_CPT')) return;

defined('MBK_APP_URL') || define('MBK_APP_URL', 'https://mbayoumkeur.shop/agriculteur');

// L'application est sur un autre domaine que WordPress : il faut l'accepter comme destination d'une redirection
add_filter('allowed_redirect_hosts', function ($hosts) {
  $host = wp_parse_url(MBK_APP_URL, PHP_URL_HOST);
  if ($host) $hosts[] = $host;
  return $hosts;
});

// 1. Connexion depuis un téléphone → application.
// Le formulaire de connexion de WordPress envoie toujours une page « demandée » (le tableau de bord par défaut) :
// on ne respecte que les demandes précises, par exemple le lien d'un e-mail vers une plante.
add_filter('login_redirect', function ($to, $requested, $user) {
  if (!($user instanceof WP_User) || !in_array(MBK_ROLE, (array) $user->roles, true) || !wp_is_mobile()) return $to;
  $generic = array_map('untrailingslashit', [admin_url(), admin_url('index.php'), admin_url('edit.php?post_type=' . MBK_CPT)]);
  if ((string) $requested === '' || in_array(untrailingslashit((string) $requested), $generic, true)) return MBK_APP_URL;
  return $to;
}, 20, 3);

// 2. Liste « Mes plantes » (sans filtre) ouverte sur téléphone → application
add_action('admin_init', function () {
  global $pagenow;
  if (!mbk_is_farmer() || !wp_is_mobile() || wp_doing_ajax() || wp_doing_cron()) return;
  if ($pagenow !== 'edit.php' || ($_GET['post_type'] ?? '') !== MBK_CPT) return;
  if (count($_GET) > 1) return; // filtre, recherche, page 2, ?classique=1… : version classique
  wp_redirect(MBK_APP_URL);
  exit;
}, 0);

// 3. Message sur la page de connexion (pour tout le monde : on ne sait pas encore qui se connecte) …
add_filter('login_message', function ($message) {
  return $message . '<p class="message">Agriculteur ? Sur téléphone, utilisez <a href="' . esc_url(MBK_APP_URL) . '"><strong>l’application Mbayoumkeur</strong></a> : photo, prix et stock en quelques gestes.</p>';
});

// … et dans l'administration, pour les agriculteurs sur téléphone
add_action('admin_notices', function () {
  if (!mbk_is_farmer() || !wp_is_mobile()) return;
  echo '<div class="notice notice-info"><p>Sur téléphone, <a href="' . esc_url(MBK_APP_URL) . '"><strong>l’application Mbayoumkeur</strong></a> est plus simple : photo, prix et stock en quelques gestes.</p></div>';
});
