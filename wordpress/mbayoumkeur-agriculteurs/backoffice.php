<?php
/**
 * Mbayoumkeur – habillage du back-office :
 *  - toute référence à WordPress masquée (logo, pied de page, titres, tableau de bord, connexion…)
 *  - couleurs de la marque, icône « feuille », emojis par catégorie
 *  - catégories de plantes (« Catégorie d'univers ») dans le menu de gauche, avec filtre de la liste
 *
 * Chargé par ../mbayoumkeur-agriculteurs.php après core.php.
 */
if (!defined('ABSPATH')) exit;
if (!function_exists('mbk_is_farmer') || !defined('MBK_CPT')) return;

const MBK_UNIVERS_FIELD = 'field_plante_univers';
const MBK_UNIVERS_META = 'categorie_univers';
const MBK_MENU_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PHBhdGggZmlsbD0iI2E3YWFhZCIgZD0iTTE3IDJDOSAyIDMgNiAzIDEyYzAgMS41LjUgMi44IDEuMyAzLjhDNSAxMiA4IDkgMTIgNy41IDguNSA5LjUgNiAxMi41IDUgMTdjLjUuMiAxIC4zIDEuNS4zIDYgMCAxMC41LTUgMTAuNS0xMS41VjJ6Ii8+PC9zdmc+';

/* ------------------------------------------------------------------ */
/* Catégories (champ « Catégorie d'univers »)                           */
/* ------------------------------------------------------------------ */
function mbk_univers_choices(): array {
  if (function_exists('acf_get_field')) {
    $f = acf_get_field(MBK_UNIVERS_FIELD);
    if ($f && !empty($f['choices'])) {
      $c = array_filter((array) $f['choices'], 'strlen');
      if ($c) return $c;
    }
  }
  return [
    'herbes-aromatiques' => 'Herbes aromatiques',
    'plantes-comestibles' => 'Plantes comestibles',
    'arbres-fruitiers' => 'Arbres fruitiers',
    'fleurs' => 'Fleurs',
    'terreaux' => 'Terreaux et substrat',
    'accessoires' => 'Accessoires de jardinage',
    'produits-phyto' => 'Produits phyto',
  ];
}

function mbk_univers_icon(string $slug): string {
  $icons = [
    'herbes-aromatiques' => '🌿',
    'plantes-comestibles' => '🥬',
    'arbres-fruitiers' => '🌳',
    'fleurs' => '🌸',
    'terreaux' => '🌱',
    'accessoires' => '✂️',
    'produits-phyto' => '🧴',
  ];
  return $icons[$slug] ?? '🪴';
}

function mbk_count_univers(string $slug, bool $own_only): int {
  $args = [
    'post_type' => MBK_CPT,
    'post_status' => ['publish', 'draft', 'pending', 'private'],
    'meta_key' => MBK_UNIVERS_META,
    'meta_value' => $slug,
    'posts_per_page' => 1,
    'fields' => 'ids',
  ];
  if ($own_only) $args['author'] = get_current_user_id();
  $q = new WP_Query($args);
  return (int) $q->found_posts;
}

// Menu de gauche : icône feuille + sous-menu par catégorie
add_action('admin_menu', function () {
  global $menu, $submenu;
  $parent = 'edit.php?post_type=' . MBK_CPT;
  $farmer = mbk_is_farmer();

  foreach ((array) $menu as $k => $m) {
    if ($m[2] === $parent) {
      $menu[$k][6] = MBK_MENU_ICON;
      $menu[$k][0] = $farmer ? 'Mes plantes' : 'Plantes';
    }
    if ($farmer && $m[2] === 'profile.php') $menu[$k][0] = 'Mon profil';
  }
  if (empty($submenu[$parent])) return;

  $items = [[$farmer ? 'Toutes mes plantes' : 'Toutes les plantes', 'edit_posts', $parent]];
  foreach (mbk_univers_choices() as $slug => $label) {
    $items[] = [
      mbk_univers_icon($slug) . ' ' . esc_html($label) . ' <span class="mbk-count">' . mbk_count_univers($slug, $farmer) . '</span>',
      'edit_posts',
      $parent . '&mbk_univers=' . $slug,
    ];
  }
  $items[] = [$farmer ? '➕ Ajouter une plante' : '➕ Ajouter', 'edit_posts', 'post-new.php?post_type=' . MBK_CPT];

  if (!$farmer) { // l'administrateur garde les éventuels autres sous-menus
    foreach ($submenu[$parent] as $entry) {
      if ($entry[2] !== $parent && $entry[2] !== 'post-new.php?post_type=' . MBK_CPT) $items[] = $entry;
    }
  }
  $submenu[$parent] = $items;
}, 10001);

// L'entrée du sous-menu reste surlignée quand une catégorie est affichée
add_filter('submenu_file', function ($file) {
  global $pagenow;
  if ($pagenow === 'edit.php' && ($_GET['post_type'] ?? '') === MBK_CPT && !empty($_GET['mbk_univers'])) {
    return 'edit.php?post_type=' . MBK_CPT . '&mbk_univers=' . sanitize_key($_GET['mbk_univers']);
  }
  return $file;
});

// Filtre de la liste : seules les plantes de la catégorie choisie
add_action('pre_get_posts', function ($q) {
  global $pagenow;
  if (!is_admin() || !$q->is_main_query() || $pagenow !== 'edit.php' || $q->get('post_type') !== MBK_CPT) return;
  $u = sanitize_key($_GET['mbk_univers'] ?? '');
  if ($u === '') return;
  $mq = (array) $q->get('meta_query');
  $mq[] = ['key' => MBK_UNIVERS_META, 'value' => $u];
  $q->set('meta_query', $mq);
});

// Les liens « Tous / Publié / Brouillon » gardent la catégorie
add_filter('views_edit-' . MBK_CPT, function ($views) {
  $u = sanitize_key($_GET['mbk_univers'] ?? '');
  if ($u === '') return $views;
  foreach ($views as $k => $v) {
    $views[$k] = preg_replace('/href=([\'"])([^\'"]*)\1/', 'href=$1$2&amp;mbk_univers=' . $u . '$1', $v, 1);
  }
  return $views;
});

// Bandeau : catégorie affichée + retour à toutes les plantes
add_action('admin_notices', function () {
  $screen = function_exists('get_current_screen') ? get_current_screen() : null;
  if (!$screen || $screen->id !== 'edit-' . MBK_CPT) return;
  $u = sanitize_key($_GET['mbk_univers'] ?? '');
  if ($u === '') return;
  $choices = mbk_univers_choices();
  $label = $choices[$u] ?? $u;
  printf('<div class="notice notice-info"><p>%s Catégorie : <strong>%s</strong> — <a href="%s">Voir toutes les plantes</a></p></div>',
    mbk_univers_icon($u), esc_html($label), esc_url(admin_url('edit.php?post_type=' . MBK_CPT)));
});

// Libellés en français « plante » (au lieu de « article »)
add_filter('post_type_labels_' . MBK_CPT, function ($l) {
  $l->name = 'Plantes';
  $l->singular_name = 'Plante';
  $l->add_new = 'Ajouter une plante';
  $l->add_new_item = 'Ajouter une plante';
  $l->edit_item = 'Modifier la plante';
  $l->new_item = 'Nouvelle plante';
  $l->view_item = 'Voir la plante';
  $l->search_items = 'Rechercher une plante';
  $l->not_found = 'Aucune plante trouvée.';
  $l->not_found_in_trash = 'Aucune plante dans la corbeille.';
  $l->all_items = 'Toutes les plantes';
  return $l;
});

/* ------------------------------------------------------------------ */
/* Masquer WordPress                                                   */
/* ------------------------------------------------------------------ */
add_action('admin_bar_menu', function ($bar) { $bar->remove_node('wp-logo'); }, 999);
add_filter('admin_footer_text', fn () => 'Mbayoumkeur · Espace producteurs');
add_filter('update_footer', '__return_empty_string', 99);
add_filter('admin_title', fn ($admin_title, $title) => $title . ' ‹ Mbayoumkeur', 10, 2);
add_filter('login_title', fn ($login_title, $title) => $title . ' ‹ Mbayoumkeur', 10, 2);
add_filter('login_headerurl', fn () => home_url('/'));
add_filter('login_headertext', fn () => 'Mbayoumkeur');
add_filter('the_generator', '__return_empty_string');
remove_action('wp_head', 'wp_generator');

add_action('admin_init', function () {
  remove_action('welcome_panel', 'wp_welcome_panel');
  if (mbk_is_farmer()) {
    remove_action('admin_notices', 'update_nag', 3);
    remove_action('admin_notices', 'maintenance_nag', 10);
    remove_action('admin_color_scheme_picker', 'admin_color_scheme_picker');
  }
});

// Aide contextuelle (pleine de références à WordPress) : retirée juste avant l'affichage
add_action('in_admin_header', function () {
  $screen = get_current_screen();
  if ($screen) $screen->remove_help_tabs();
}, 999);

// Tableau de bord : on retire les blocs WordPress, on met un message de bienvenue
add_action('wp_dashboard_setup', function () {
  global $wp_meta_boxes;
  $wp_meta_boxes['dashboard'] = [];
  wp_add_dashboard_widget('mbk_welcome', '🌿 Bienvenue sur Mbayoumkeur', function () {
    echo '<p>Publiez vos plantes depuis le menu <strong>Plantes</strong>, à gauche. Choisissez une catégorie pour ne voir que les plantes qu\'elle contient.</p>';
    echo '<p><a class="button button-primary" href="' . esc_url(admin_url('edit.php?post_type=' . MBK_CPT)) . '">Voir les plantes</a> ';
    echo '<a class="button" href="' . esc_url(admin_url('post-new.php?post_type=' . MBK_CPT)) . '">➕ Ajouter une plante</a></p>';
  });
}, 999);

/* ------------------------------------------------------------------ */
/* Couleurs de la marque                                               */
/* ------------------------------------------------------------------ */
function mbk_brand_css(): string {
  $css = <<<'CSS'
:root{--wp-admin-theme-color:#3a7d04;--wp-admin-theme-color--rgb:58,125,4;--wp-admin-theme-color-darker-10:#2b6403;--wp-admin-theme-color-darker-10--rgb:43,100,3;--wp-admin-theme-color-darker-20:#04481a;--wp-admin-theme-color-darker-20--rgb:4,72,26}
body.wp-admin{background:#f2f9ea}
a{color:#2b6403}a:hover{color:#04481a}
#adminmenuback,#adminmenuwrap,#adminmenu{background:#04481a}
#adminmenu a{color:#e1f1cd}
#adminmenu div.wp-menu-image:before{color:#a8d5b3}
#adminmenu li.menu-top:hover,#adminmenu li.opensub>a.menu-top,#adminmenu li>a.menu-top:focus{background:#2b6403;color:#fff}
#adminmenu li.menu-top:hover div.wp-menu-image:before,#adminmenu li.opensub>a.menu-top div.wp-menu-image:before{color:#fff}
#adminmenu li.current a.menu-top,#adminmenu li.wp-has-current-submenu a.wp-has-current-submenu,#adminmenu li.wp-has-current-submenu.opensub a.wp-has-current-submenu{background:#3a7d04;color:#fff}
#adminmenu li.wp-has-current-submenu div.wp-menu-image:before,#adminmenu li.current div.wp-menu-image:before{color:#fff}
#adminmenu .wp-submenu,#adminmenu .wp-has-current-submenu .wp-submenu,#adminmenu a.wp-has-current-submenu:focus+.wp-submenu{background:#033514}
#adminmenu .wp-submenu a{color:#c9e6cf}
#adminmenu .wp-submenu a:hover,#adminmenu .wp-submenu a:focus,#adminmenu .wp-submenu li.current a{color:#f2a900}
#adminmenu .wp-submenu .wp-submenu-head,#adminmenu .wp-has-current-submenu .wp-submenu .wp-submenu-head{background:#3a7d04;color:#fff}
#adminmenu .mbk-count{display:inline-block;float:none;background:#3a7d04;color:#fff;border-radius:9px;padding:0 7px;font-size:11px;line-height:17px;margin-left:6px;vertical-align:middle}
#adminmenu .wp-submenu li.current .mbk-count,#adminmenu .wp-submenu a:hover .mbk-count{background:#f2a900;color:#04481a}
#collapse-button,#collapse-button:hover{color:#a8d5b3}
#wpadminbar{background:#04481a}
#wpadminbar .ab-item,#wpadminbar a.ab-item,#wpadminbar #adminbarsearch:before{color:#e1f1cd}
#wpadminbar .ab-top-menu>li:hover>.ab-item,#wpadminbar .ab-top-menu>li.hover>.ab-item{background:#2b6403;color:#fff}
.wp-core-ui .button-primary{background:#3a7d04;border-color:#2b6403;color:#fff}
.wp-core-ui .button-primary:hover,.wp-core-ui .button-primary:focus{background:#2b6403;border-color:#04481a;color:#fff}
.wp-core-ui .button,.wp-core-ui .button-secondary{color:#2b6403;border-color:#3a7d04}
.wp-core-ui .button:hover{background:#f2f9ea;border-color:#2b6403;color:#04481a}
.wrap h1.wp-heading-inline:before{content:"🌿 "}
.notice-info{border-left-color:#3a7d04}
#wpfooter,#wpfooter a{color:#2b6403}
body.login{background:#f2f9ea}
.login #login h1 a{background:url({{LOGO}}) center/contain no-repeat!important;width:300px;height:92px;text-indent:-9999px;font-size:0;overflow:hidden;box-shadow:none}
#adminmenu::before{content:"";display:block;height:62px;margin:10px 10px 14px;padding:6px;box-sizing:border-box;border-radius:12px;background:#fff url({{LOGO}}) center/contain no-repeat;background-origin:content-box}
.folded #adminmenu::before{height:36px;margin:8px 2px;padding:2px;background-image:url({{ICON}})}
@media screen and (max-width:960px){.auto-fold #adminmenu::before{height:36px;margin:8px 2px;padding:2px;background-image:url({{ICON}})}}
.login form{border-radius:14px;border-color:#e1f1cd}
.login .language-switcher{display:none}
.login #nav a,.login #backtoblog a{color:#2b6403}
.login .button-primary{background:#3a7d04;border-color:#2b6403}
CSS;
  if (mbk_is_farmer()) {
    // Profil simplifié : on ne garde que l'essentiel
    $css .= '.user-rich-editing-wrap,.user-syntax-highlighting-wrap,.user-comment-shortcuts-wrap,.user-admin-bar-front-wrap,.user-admin-color-wrap,.user-url-wrap,.user-description-wrap,.application-passwords,.user-language-wrap{display:none!important}';
  }
  $base = (defined('WPMU_PLUGIN_URL') ? WPMU_PLUGIN_URL : content_url('mu-plugins')) . '/mbayoumkeur-agriculteurs/assets/';
  return str_replace(['{{LOGO}}', '{{ICON}}'], [$base . 'logo.png', $base . 'icon.png'], $css);
}
function mbk_favicon() {
  $base = (defined('WPMU_PLUGIN_URL') ? WPMU_PLUGIN_URL : content_url('mu-plugins')) . '/mbayoumkeur-agriculteurs/assets/';
  echo '<link rel="icon" type="image/png" href="' . esc_url($base . 'icon.png') . '">';
}
add_action('admin_head', 'mbk_favicon', 99);
add_action('login_head', 'mbk_favicon', 99);
add_action('admin_head', function () { echo '<style id="mbk-brand">' . mbk_brand_css() . '</style>'; });
add_action('login_head', function () { echo '<style id="mbk-brand">' . mbk_brand_css() . '</style>'; });
