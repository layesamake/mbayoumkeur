<?php
/**
 * Plugin Name: Mbayoumkeur – Espace agriculteur (chargeur)
 * Description: Charge mbayoumkeur-agriculteurs/core.php (rôle, confidentialité) puis backoffice.php (habillage) et api.php (API de l'application agriculteur).
 *              Une erreur dans l'un des fichiers est interceptée pour ne jamais bloquer tout le site.
 *
 * À copier dans wp-content/mu-plugins/ avec le dossier mbayoumkeur-agriculteurs/.
 */
if (!defined('ABSPATH')) exit;
foreach (['core.php', 'backoffice.php', 'api.php'] as $mbk_file) {
  try {
    require __DIR__ . '/mbayoumkeur-agriculteurs/' . $mbk_file;
  } catch (\Throwable $e) {
    error_log('mbayoumkeur-agriculteurs/' . $mbk_file . ' : ' . $e->getMessage());
  }
}
