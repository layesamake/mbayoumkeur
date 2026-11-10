<?php
/**
 * Plugin Name: Mbayoumkeur – Espace agriculteur (chargeur)
 * Description: Charge mbayoumkeur-agriculteurs/core.php. Une erreur de syntaxe dans le cœur est interceptée
 *              pour ne jamais bloquer tout le site WordPress.
 *
 * À copier dans wp-content/mu-plugins/ avec le dossier mbayoumkeur-agriculteurs/.
 */
if (!defined('ABSPATH')) exit;
try {
  require __DIR__ . '/mbayoumkeur-agriculteurs/core.php';
} catch (\Throwable $e) {
  error_log('mbayoumkeur-agriculteurs : ' . $e->getMessage());
}
