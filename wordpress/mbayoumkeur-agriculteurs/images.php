<?php
/**
 * Mbayoumkeur – Optimisation des images (chargé par ../mbayoumkeur-agriculteurs.php).
 * Toute photo envoyée (téléphone d'un agriculteur, médiathèque, API) est redressée, réduite à 1600 px,
 * convertie en WebP et débarrassée de ses métadonnées (position GPS comprise). Les tailles inutiles
 * ne sont plus générées. Outil de rattrapage pour les images déjà en ligne : Outils › Optimiser les images
 * ou `wp mbk-images optimize`.
 *
 * Principe : une panne ici ne doit JAMAIS empêcher l'envoi d'une photo (tout est enveloppé, l'original est conservé en repli).
 */
if (!defined('ABSPATH')) exit;

defined('MBK_IMG_MAX') || define('MBK_IMG_MAX', 1600);             // plus grand côté, en pixels
defined('MBK_IMG_QUALITY_WEBP') || define('MBK_IMG_QUALITY_WEBP', 78);
defined('MBK_IMG_QUALITY_JPEG') || define('MBK_IMG_QUALITY_JPEG', 80);
defined('MBK_IMG_BATCH') || define('MBK_IMG_BATCH', 4);            // images traitées par appel dans la page d'outils

const MBK_IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/* ------------------------------------------------------------------ */
/* 1. Moteur : lecture, redressement, réduction, nettoyage, écriture    */
/* ------------------------------------------------------------------ */
function mbk_img_can_webp(): bool {
  static $ok = null;
  if ($ok !== null) return $ok;
  $ok = false;
  if (class_exists('Imagick')) {
    try { $ok = in_array('WEBP', Imagick::queryFormats('WEBP'), true); } catch (\Throwable $e) { $ok = false; }
  }
  if (!$ok) $ok = function_exists('imagewebp');
  return $ok;
}

/**
 * Convertit $src vers $dst. Retourne ['mime','ext','width','height'] ou WP_Error.
 * Sortie : WebP si le serveur le sait, sinon JPEG optimisé (PNG sans transparence) ou PNG.
 */
function mbk_img_render(string $src, string $dst, string $mime) {
  if (function_exists('wp_raise_memory_limit')) wp_raise_memory_limit('image');
  $webp = mbk_img_can_webp();
  try {
    if (class_exists('Imagick')) return mbk_img_render_imagick($src, $dst, $mime, $webp);
    if (function_exists('imagecreatefromstring')) return mbk_img_render_gd($src, $dst, $mime, $webp);
  } catch (\Throwable $e) {
    return new WP_Error('mbk_img', $e->getMessage());
  }
  return new WP_Error('mbk_img', 'Aucune bibliothèque d’images (Imagick ou GD) disponible.');
}

function mbk_img_render_imagick(string $src, string $dst, string $mime, bool $webp) {
  $im = new Imagick();
  $im->readImage($src);
  if ($im->getNumberImages() > 1) $im->setIteratorIndex(0);

  // 1. Orientation (les téléphones enregistrent la photo « couchée » + une étiquette EXIF)
  switch ($im->getImageOrientation()) {
    case Imagick::ORIENTATION_BOTTOMRIGHT: $im->rotateImage('#000', 180); break;
    case Imagick::ORIENTATION_RIGHTTOP:    $im->rotateImage('#000', 90); break;
    case Imagick::ORIENTATION_LEFTBOTTOM:  $im->rotateImage('#000', 270); break;
  }
  $im->setImageOrientation(Imagick::ORIENTATION_TOPLEFT);

  // 2. Réduction
  $w = $im->getImageWidth(); $h = $im->getImageHeight();
  if (max($w, $h) > MBK_IMG_MAX) {
    $k = MBK_IMG_MAX / max($w, $h);
    $im->resizeImage(max(1, (int) round($w * $k)), max(1, (int) round($h * $k)), Imagick::FILTER_LANCZOS, 1);
  }

  // 3. Nettoyage : EXIF, GPS, XMP… disparaissent ; on garde le profil de couleur pour ne pas ternir les verts
  $icc = null;
  try { $p = $im->getImageProfiles('icc', true); $icc = $p['icc'] ?? null; } catch (\Throwable $e) { $icc = null; }
  $im->stripImage();
  if ($icc) { try { $im->profileImage('icc', $icc); } catch (\Throwable $e) {} }

  // 4. Écriture
  $alpha = $mime === 'image/png' && $im->getImageAlphaChannel();
  if ($webp) {
    $im->setImageFormat('webp');
    $im->setImageCompressionQuality(MBK_IMG_QUALITY_WEBP);
    $im->setOption('webp:method', '6');
    $out = ['image/webp', 'webp'];
  } elseif ($alpha) {
    $im->setImageFormat('png');
    $out = ['image/png', 'png'];
  } else {
    if ($mime === 'image/png') $im->setImageBackgroundColor('white');
    $im->setImageFormat('jpeg');
    $im->setImageCompressionQuality(MBK_IMG_QUALITY_JPEG);
    $im->setInterlaceScheme(Imagick::INTERLACE_PLANE);
    $out = ['image/jpeg', 'jpg'];
  }
  $im->writeImage($dst);
  $res = ['mime' => $out[0], 'ext' => $out[1], 'width' => $im->getImageWidth(), 'height' => $im->getImageHeight()];
  $im->clear(); $im->destroy();
  return $res;
}

function mbk_img_render_gd(string $src, string $dst, string $mime, bool $webp) {
  $data = file_get_contents($src);
  $img = $data === false ? false : @imagecreatefromstring($data);
  if (!$img) return new WP_Error('mbk_img', 'Image illisible.');

  if ($mime === 'image/jpeg' && function_exists('exif_read_data')) {
    $exif = @exif_read_data($src);
    $o = (int) ($exif['Orientation'] ?? 1);
    $angle = [3 => 180, 6 => -90, 8 => 90][$o] ?? 0;
    if ($angle) { $r = imagerotate($img, $angle, 0); if ($r) $img = $r; }
  }
  $w = imagesx($img); $h = imagesy($img);
  if (max($w, $h) > MBK_IMG_MAX) {
    $k = MBK_IMG_MAX / max($w, $h);
    $nw = max(1, (int) round($w * $k)); $nh = max(1, (int) round($h * $k));
    // certaines versions de GD refusent IMG_BICUBIC : on retombe alors sur le mode par défaut (trouvé en exécutant le code pour de vrai)
    $r = @imagescale($img, $nw, $nh, IMG_BICUBIC) ?: @imagescale($img, $nw, $nh);
    if ($r) $img = $r;
  }
  imagepalettetotruecolor($img);
  $alpha = $mime === 'image/png';
  if ($alpha) { imagealphablending($img, false); imagesavealpha($img, true); }

  // GD n'écrit aucune métadonnée : EXIF et GPS disparaissent d'office
  if ($webp) { $ok = imagewebp($img, $dst, MBK_IMG_QUALITY_WEBP); $out = ['image/webp', 'webp']; }
  elseif ($alpha) { $ok = imagepng($img, $dst, 7); $out = ['image/png', 'png']; }
  else { imageinterlace($img, true); $ok = imagejpeg($img, $dst, MBK_IMG_QUALITY_JPEG); $out = ['image/jpeg', 'jpg']; }
  $res = ['mime' => $out[0], 'ext' => $out[1], 'width' => imagesx($img), 'height' => imagesy($img)];
  imagedestroy($img);
  return $ok ? $res : new WP_Error('mbk_img', 'Écriture de l’image impossible.');
}

/**
 * Optimise $src vers $dst seulement si le résultat est plus léger. Retourne le résultat de mbk_img_render,
 * ou WP_Error (dont le code « mbk_img_skip » signifie « rien à gagner », pas une panne).
 */
function mbk_img_optimize_file(string $src, string $mime, string $dst) {
  if (!in_array($mime, MBK_IMG_TYPES, true)) return new WP_Error('mbk_img_skip', 'Type non géré.');
  $before = @filesize($src);
  $res = mbk_img_render($src, $dst, $mime);
  if (is_wp_error($res)) { @unlink($dst); return $res; }
  $after = @filesize($dst);
  if (!$after || ($before && $after >= $before)) {
    @unlink($dst);
    return new WP_Error('mbk_img_skip', 'Déjà optimisée.');
  }
  $res['before'] = (int) $before; $res['after'] = (int) $after;
  return $res;
}

/* ------------------------------------------------------------------ */
/* 2. À l'envoi : la photo est traitée avant d'être rangée par WordPress */
/* ------------------------------------------------------------------ */
add_filter('wp_handle_upload_prefilter', function ($file) {
  try {
    if (!empty($file['error']) || empty($file['tmp_name']) || !is_readable($file['tmp_name'])) return $file;
    $real = function_exists('wp_get_image_mime') ? wp_get_image_mime($file['tmp_name']) : ($file['type'] ?? '');
    if (!in_array($real, MBK_IMG_TYPES, true)) return $file;

    $tmp = $file['tmp_name'] . '.mbk';
    $res = mbk_img_optimize_file($file['tmp_name'], $real, $tmp);
    if (is_wp_error($res)) {
      if ($res->get_error_code() !== 'mbk_img_skip') error_log('mbayoumkeur-images : ' . $res->get_error_message());
      return $file; // on garde l'original : un envoi ne doit jamais échouer à cause de l'optimisation
    }
    // le fichier temporaire garde son chemin (PHP le reconnaît comme « envoyé »), seul son contenu change
    if (!@rename($tmp, $file['tmp_name'])) {
      if (!@copy($tmp, $file['tmp_name'])) { @unlink($tmp); return $file; }
      @unlink($tmp);
    }
    $file['name'] = pathinfo($file['name'], PATHINFO_FILENAME) . '.' . $res['ext'];
    $file['type'] = $res['mime'];
    $file['size'] = $res['after'];
  } catch (\Throwable $e) {
    error_log('mbayoumkeur-images : ' . $e->getMessage());
  }
  return $file;
});

/* ------------------------------------------------------------------ */
/* 3. Tailles : trois formats web + la vignette de l'administration      */
/* ------------------------------------------------------------------ */
add_action('init', function () {
  add_image_size('mbk-400', 400, 9999, false);
  add_image_size('mbk-800', 800, 9999, false);
  add_image_size('mbk-1200', 1200, 9999, false);
}, 20);

add_filter('intermediate_image_sizes_advanced', function ($sizes) {
  return array_intersect_key($sizes, array_flip(['thumbnail', 'mbk-400', 'mbk-800', 'mbk-1200']));
});
add_filter('big_image_size_threshold', '__return_false'); // la réduction à 1600 px est déjà faite
add_filter('wp_editor_set_quality', function ($q, $mime) {
  return $mime === 'image/webp' ? MBK_IMG_QUALITY_WEBP : ($mime === 'image/jpeg' ? MBK_IMG_QUALITY_JPEG : $q);
}, 10, 2);

/* ------------------------------------------------------------------ */
/* 4. Rattrapage des images déjà en ligne                               */
/* ------------------------------------------------------------------ */
function mbk_img_backup_dir(): string {
  $dir = WP_CONTENT_DIR . '/mbk-originals';
  if (!is_dir($dir)) {
    wp_mkdir_p($dir);
    // jamais accessible depuis Internet : les originaux contiennent encore l'EXIF (GPS)
    file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    file_put_contents($dir . '/index.php', "<?php // silence\n");
  }
  return $dir;
}

/** Optimise une pièce jointe en place. Retourne ['status' => ok|skip|error|dry, 'before', 'after', 'message'] */
function mbk_img_optimize_attachment(int $id, bool $dry = false, bool $backup = true): array {
  $file = get_attached_file($id);
  $mime = get_post_mime_type($id);
  if (!$file || !file_exists($file)) return ['status' => 'error', 'message' => 'Fichier introuvable', 'before' => 0, 'after' => 0];
  if (!in_array($mime, ['image/jpeg', 'image/png'], true)) return ['status' => 'skip', 'message' => 'Déjà au format web', 'before' => 0, 'after' => 0];

  $tmp = $file . '.mbk';
  $res = mbk_img_optimize_file($file, $mime, $tmp);
  if (is_wp_error($res)) {
    return ['status' => $res->get_error_code() === 'mbk_img_skip' ? 'skip' : 'error', 'message' => $res->get_error_message(), 'before' => 0, 'after' => 0];
  }
  if ($dry) { @unlink($tmp); return ['status' => 'dry', 'message' => '', 'before' => $res['before'], 'after' => $res['after']]; }

  $dir = dirname($file);
  $meta = wp_get_attachment_metadata($id);
  if ($backup) {
    $rel = ltrim(str_replace('\\', '/', substr($file, strlen(wp_get_upload_dir()['basedir']))), '/');
    $to = mbk_img_backup_dir() . '/' . $rel;
    wp_mkdir_p(dirname($to));
    if (!@copy($file, $to)) { @unlink($tmp); return ['status' => 'error', 'message' => 'Sauvegarde impossible', 'before' => 0, 'after' => 0]; }
  }
  $name = wp_unique_filename($dir, pathinfo($file, PATHINFO_FILENAME) . '.' . $res['ext']);
  $new = $dir . '/' . $name;
  if (!@rename($tmp, $new)) { @unlink($tmp); return ['status' => 'error', 'message' => 'Écriture impossible', 'before' => 0, 'after' => 0]; }

  // anciennes tailles et ancien original
  if (!empty($meta['sizes'])) foreach ($meta['sizes'] as $s) if (!empty($s['file'])) @unlink($dir . '/' . $s['file']);
  if (!empty($meta['original_image'])) @unlink($dir . '/' . $meta['original_image']);
  @unlink($file);

  update_attached_file($id, $new);
  global $wpdb;
  $wpdb->update($wpdb->posts, ['post_mime_type' => $res['mime'], 'guid' => wp_get_attachment_url($id)], ['ID' => $id]);
  clean_post_cache($id);
  require_once ABSPATH . 'wp-admin/includes/image.php';
  wp_update_attachment_metadata($id, wp_generate_attachment_metadata($id, $new));
  return ['status' => 'ok', 'message' => '', 'before' => $res['before'], 'after' => $res['after']];
}

function mbk_img_pending_ids(int $limit = -1): array {
  return get_posts([
    'post_type' => 'attachment', 'post_status' => 'inherit', 'post_mime_type' => ['image/jpeg', 'image/png'],
    'posts_per_page' => $limit, 'fields' => 'ids', 'orderby' => 'ID', 'order' => 'ASC', 'no_found_rows' => true,
  ]);
}

// --- WP-CLI : wp mbk-images optimize [--dry-run] [--no-backup] [--limit=50] ---
if (defined('WP_CLI') && WP_CLI) {
  class MBK_Images_CLI {
    /**
     * Optimise les images déjà en ligne (WebP, 1600 px, sans GPS).
     *
     * ## OPTIONS
     * [--dry-run]   Simule et affiche le gain sans rien modifier.
     * [--no-backup] Ne conserve pas les originaux dans wp-content/mbk-originals.
     * [--limit=<n>] Nombre maximum d'images.
     */
    public function optimize($args, $assoc) {
      $dry = isset($assoc['dry-run']);
      $backup = !isset($assoc['no-backup']);
      $ids = mbk_img_pending_ids(isset($assoc['limit']) ? (int) $assoc['limit'] : -1);
      $tot_b = $tot_a = $n = 0;
      foreach ($ids as $id) {
        $r = mbk_img_optimize_attachment((int) $id, $dry, $backup);
        if ($r['status'] === 'error') WP_CLI::warning("#$id : " . $r['message']);
        if (in_array($r['status'], ['ok', 'dry'], true)) { $tot_b += $r['before']; $tot_a += $r['after']; $n++; }
      }
      WP_CLI::success(sprintf('%s%d image(s), %s → %s (−%s).', $dry ? '[simulation] ' : '', $n,
        size_format($tot_b), size_format($tot_a), size_format(max(0, $tot_b - $tot_a))));
    }
  }
  WP_CLI::add_command('mbk-images', 'MBK_Images_CLI');
}

// --- Page « Outils › Optimiser les images » (administrateur) ---
add_action('admin_menu', function () {
  add_management_page('Optimiser les images', 'Optimiser les images', 'manage_options', 'mbk-images', function () {
    $left = count(mbk_img_pending_ids());
    $nonce = wp_create_nonce('mbk_img');
    $ajax = admin_url('admin-ajax.php');
    $can = mbk_img_can_webp() ? 'WebP' : 'JPEG (WebP indisponible sur ce serveur)';
    ?>
    <div class="wrap">
      <h1>Optimiser les images</h1>
      <p>Réduit à <?php echo (int) MBK_IMG_MAX; ?> px, convertit en <strong><?php echo esc_html($can); ?></strong> et retire la position GPS des photos déjà en ligne.
         Les originaux sont conservés dans un dossier privé (<code>wp-content/mbk-originals</code>) tant que vous ne les supprimez pas.</p>
      <p><strong id="mbk-left"><?php echo (int) $left; ?></strong> image(s) à traiter.</p>
      <p><label><input type="checkbox" id="mbk-dry"> Simulation seulement (rien n'est modifié)</label></p>
      <p><button class="button button-primary" id="mbk-go" <?php disabled(!$left); ?>>Lancer</button>
         <span id="mbk-out" style="margin-left:12px"></span></p>
      <script>
      (() => {
        const go = document.getElementById('mbk-go'), out = document.getElementById('mbk-out'), left = document.getElementById('mbk-left');
        let before = 0, after = 0, done = 0, offset = 0, running = false;
        const fmt = (n) => (n / 1048576).toFixed(1) + ' Mo';
        async function step() {
          const body = new URLSearchParams({ action: 'mbk_img_batch', _wpnonce: '<?php echo esc_js($nonce); ?>', dry: document.getElementById('mbk-dry').checked ? 1 : 0, offset });
          const r = await (await fetch('<?php echo esc_url_raw($ajax); ?>', { method: 'POST', body })).json();
          if (!r.success) { out.textContent = 'Erreur : ' + (r.data || 'inconnue'); running = false; go.disabled = false; return; }
          before += r.data.before; after += r.data.after; done += r.data.done; offset = r.data.offset;
          left.textContent = r.data.remaining;
          out.textContent = done + ' traitée(s), ' + fmt(before) + ' → ' + fmt(after) + ' (−' + fmt(before - after) + ')';
          if (r.data.remaining > 0 && r.data.batch > 0) return step();
          running = false; go.disabled = false; out.textContent += ' · terminé';
        }
        go.addEventListener('click', () => { if (running) return; running = true; go.disabled = true; before = after = done = offset = 0; step(); });
      })();
      </script>
    </div>
    <?php
  });
});

add_action('wp_ajax_mbk_img_batch', function () {
  if (!current_user_can('manage_options') || !wp_verify_nonce($_POST['_wpnonce'] ?? '', 'mbk_img')) wp_send_json_error('Non autorisé', 403);
  @set_time_limit(120);
  $dry = !empty($_POST['dry']);
  $offset = max(0, (int) ($_POST['offset'] ?? 0));
  $ids = mbk_img_pending_ids();
  $slice = array_slice($ids, $offset, MBK_IMG_BATCH);
  $before = $after = $done = $stuck = 0;
  foreach ($slice as $id) {
    $r = mbk_img_optimize_attachment((int) $id, $dry, true);
    if (in_array($r['status'], ['ok', 'dry'], true)) { $before += $r['before']; $after += $r['after']; $done++; }
    else $stuck++; // « déjà optimisée » ou en erreur : reste dans la liste, on passe à la suivante
  }
  // simulation : rien ne quitte la liste, on avance de la taille du lot ; mode réel : les images traitées sortent de la liste
  $offset += $dry ? count($slice) : $stuck;
  $remaining = max(0, ($dry ? count($ids) : count(mbk_img_pending_ids())) - $offset);
  wp_send_json_success(['before' => $before, 'after' => $after, 'done' => $done, 'offset' => $offset, 'remaining' => $remaining, 'batch' => count($slice)]);
});
