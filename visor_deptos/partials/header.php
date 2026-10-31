<?php
// PLACEHOLDER: imita la estructura del encabezado del sitio de SEPA. En la integración, este
// archivo se reemplaza por el encabezado real del sitio (o lo incluye).
$pageTitle = isset($pageTitle) ? $pageTitle : 'SEPA';
?><!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?php echo htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8'); ?> — SEPA</title>
</head>
<body>
<header class="sepa-header">
  <div class="sepa-header-inner">
    <span class="sepa-logo">SEPA</span>
    <span class="sepa-tagline">Encabezado de ejemplo del sitio</span>
  </div>
  <nav class="sepa-nav" aria-label="Productos">
    <a href="#">Inicio</a>
    <a href="#">Productos</a>
    <a href="#">Focos de calor</a>
  </nav>
</header>
