<?php
/**
 * Plugin Name: Mbayoumkeur – Espace agriculteur (chargeur protégé)
 * Description: Charge, dans cet ordre, mbayoumkeur-agriculteurs/core.php (rôle, confidentialité), backoffice.php (habillage),
 *              api.php (API de l'application agriculteur) et images.php (optimisation des photos).
 *              Disjoncteur : un fichier absent, ou qui provoque une erreur fatale, est mis à l'écart automatiquement
 *              (le reste du site continue de fonctionner) et un message s'affiche dans l'administration.
 *              Il est réessayé dès que le fichier est remplacé.
 *
 * À copier dans wp-content/mu-plugins/ avec le dossier mbayoumkeur-agriculteurs/ (qui contient aussi images.php).
 */
if (!defined('ABSPATH')) exit;

(function () {
  $dir = __DIR__ . '/mbayoumkeur-agriculteurs/';
  $state = (defined('WP_CONTENT_DIR') ? WP_CONTENT_DIR : dirname(__DIR__)) . '/mbk-loader-state/';
  $files = ['core.php', 'backoffice.php', 'api.php', 'images.php'];

  // Met un fichier à l'écart : 1re ligne = empreinte du fichier fautif, puis la date et l'erreur
  $disable = function ($file, $message) use ($dir, $state) {
    $path = $dir . $file;
    if (!is_dir($state)) @mkdir($state, 0755, true);
    @file_put_contents($state . $file . '.err', (is_file($path) ? md5_file($path) : '-') . "\n" . gmdate('Y-m-d H:i:s') . " UTC\n" . $message . "\n");
  };

  // Une erreur fatale dans l'un de nos fichiers (au chargement ou plus tard, dans un crochet) le met à l'écart
  // pour les requêtes suivantes : le site se rétablit tout seul après un seul échec.
  register_shutdown_function(function () use ($dir, $disable) {
    $e = error_get_last();
    if (!$e || !in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR], true)) return;
    $f = str_replace('\\', '/', (string) $e['file']);
    $d = str_replace('\\', '/', $dir);
    if (strpos($f, $d) !== 0) return;
    $disable(basename($f), $e['message'] . ' (ligne ' . $e['line'] . ')');
  });

  foreach ($files as $file) {
    $path = $dir . $file;
    if (!is_readable($path)) { error_log('mbayoumkeur-agriculteurs : fichier absent, ignoré : ' . $file); continue; }
    $mark = $state . $file . '.err';
    if (is_file($mark)) {
      $first = strtok((string) @file_get_contents($mark), "\n");
      if ($first === md5_file($path)) continue; // même fichier que celui qui a planté : toujours à l'écart
      @unlink($mark);                            // fichier remplacé depuis : on réessaie
    }
    try {
      require $path;
    } catch (\Throwable $t) {
      $disable($file, $t->getMessage() . ' (ligne ' . $t->getLine() . ')');
    }
  }

  // Message pour l'administrateur quand un fichier a été mis à l'écart
  add_action('admin_notices', function () use ($state) {
    if (!current_user_can('manage_options') || !is_dir($state)) return;
    foreach ((glob($state . '*.err') ?: []) as $mark) {
      $lines = explode("\n", (string) file_get_contents($mark), 4);
      echo '<div class="notice notice-error"><p><strong>Mbayoumkeur :</strong> le fichier <code>' . esc_html(basename($mark, '.err'))
        . '</code> a été désactivé après une erreur : ' . esc_html(trim($lines[2] ?? ''))
        . '. Remplacez le fichier par une version corrigée pour le réactiver.</p></div>';
    }
  });
})();
