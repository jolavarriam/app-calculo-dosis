/**
 * DosisCalc — Generador de informe PDF (tamaño carta).
 * Usa jsPDF (vendorizado en vendor/jspdf.umd.min.js, MIT license) para poder
 * generar el PDF sin conexión una vez que la PWA quedó instalada/cacheada.
 *
 * Layout: arriba, en dos columnas — izquierda: ítem 1 (muestras de
 * calibración, siempre 3) + ítem 2 (Velocidad: ancho de boquilla, avance,
 * cobertura y mojamiento); derecha: ítem 3 (Caldo: área de ensayo, caldo
 * necesario, remanente, y — en formato de resultado, uno debajo del otro —
 * caldo total calculado y caldo a preparar redondeado). Debajo, a todo el
 * ancho, el ítem 4 (Tratamientos): una fila por tratamiento, con los
 * nombres de producto, dosis y dosis por carga en notación de suma literal
 * (no calculada), y el remanente del tratamiento. Si el nombre de los
 * productos no cabe en una línea, la fila crece y el resto de columnas se
 * centra verticalmente. Cada título de sección lleva una línea vertical a
 * un costado que recorre todo el contenido de esa sección (en vez de un
 * subrayado).
 *
 * Expone window.DosisPDF.generate(reportState), que devuelve una Promise
 * (necesita cargar el logo de la app antes de dibujar el encabezado).
 * reportState:
 * {
 *   fileName: string,
 *   samples: [{ label, volume, gasto }],       // siempre 3 muestras
 *   gastoPromedio: { value, unit },
 *   velocidad: {                                                        // ítem 2
 *     title, ancho: { label, value, unit },
 *     avance: { label, msValue, mminValue },
 *     cobertura: { label, value, unit }, mojamiento: { label, value, unit },
 *   },
 *   caldo: {                                                            // ítem 3
 *     title, area: { label, value, unit },
 *     caldoNecesario: { label, value, unit }, remanente: { label, value, unit },
 *     caldoTotal: { label, value, unit }, caldoPreparar: { label, value, unit },
 *   },
 *   treatments: [ { label, productos, dosis, dosisCarga, remanente } ], // ítem 4
 * }
 */
(function () {
  "use strict";

  const BRAND = {
    ink: [15, 23, 42], // #0f172a
    accent: [156, 111, 46], // versión oscura del ámbar, legible sobre blanco
    accentLight: [246, 233, 216], // fondo claro para franjas / cajas
    textMuted: [95, 105, 120],
    line: [223, 226, 232],
  };

  const PAGE = {
    format: "letter", // 215.9 x 279.4 mm
    marginX: 18,
    marginTop: 20,
    marginBottom: 18,
    columnGap: 8,
  };

  const ROW_H = 6.3; // alto de fila estándar
  const SAMPLE_ROW_H = 5.8; // alto de fila compacta (muestras y avance)
  const LINE_H = 4.2; // alto de línea extra cuando una celda pasa a 2+ líneas
  const SECTION_GAP = 4; // espacio regular entre secciones
  const ROW_FONT_SIZE = 9; // tamaño uniforme para el texto de todas las filas
  const LOGO_PATH = "icons/icon-192.png";

  function formatTimestamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    const fecha = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    const hora = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return `${fecha} · ${hora}`;
  }

  /** Intenta cargar el ícono de la app como data URL para incrustarlo en el PDF. */
  async function loadLogoDataUrl() {
    try {
      const response = await fetch(LOGO_PATH);
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  }

  /** Isotipo de respaldo ("DC") si el logo no se pudo cargar (p.ej. sin caché offline). */
  function drawFallbackMark(doc, marginX, marginTop) {
    doc.setFillColor(...BRAND.ink);
    doc.roundedRect(marginX, marginTop - 6, 10, 10, 2, 2, "F");
    doc.setTextColor(217, 168, 108);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("DC", marginX + 5, marginTop - 0.3, { align: "center" });
  }

  function drawHeader(doc, pageWidth, logoDataUrl) {
    const { marginX, marginTop } = PAGE;

    // Logo real de la app (icono de la PWA); solo si no está disponible se
    // usa el isotipo "DC" de respaldo.
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, "PNG", marginX, marginTop - 6, 10, 10, undefined, "FAST");
      } catch (e) {
        drawFallbackMark(doc, marginX, marginTop);
      }
    } else {
      drawFallbackMark(doc, marginX, marginTop);
    }

    // Nombre de marca
    doc.setTextColor(...BRAND.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("DosisCalc", marginX + 14, marginTop);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.textMuted);
    doc.text("Informe de cálculo de dosis de aplicación", marginX + 14, marginTop + 5);

    // Fecha de generación, alineada a la derecha
    doc.setFontSize(8.5);
    doc.text(`Generado: ${formatTimestamp(new Date())}`, pageWidth - marginX, marginTop, { align: "right" });

    const ruleY = marginTop + 8;
    doc.setDrawColor(...BRAND.line);
    doc.setLineWidth(0.4);
    doc.line(marginX, ruleY, pageWidth - marginX, ruleY);

    return ruleY + 7; // próxima posición Y disponible
  }

  function drawFooter(doc, pageWidth, pageHeight) {
    const { marginX, marginBottom } = PAGE;
    const y = pageHeight - marginBottom + 8;
    doc.setDrawColor(...BRAND.line);
    doc.setLineWidth(0.3);
    doc.line(marginX, y - 5, pageWidth - marginX, y - 5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.textMuted);
    doc.text(
      "Los rangos de validación son referenciales. Ajusta según tu criterio agronómico.",
      marginX,
      y
    );

    const pageCount = doc.getNumberOfPages();
    const current = doc.getCurrentPageInfo().pageNumber;
    doc.text(`Página ${current} de ${pageCount}`, pageWidth - marginX, y, { align: "right" });
  }

  /** Línea vertical al costado de una sección, a lo largo de todo su contenido. */
  function drawVerticalRule(doc, x, yTop, yBottom) {
    if (yBottom <= yTop) return;
    doc.setDrawColor(...BRAND.accent);
    doc.setLineWidth(0.7);
    doc.line(x, yTop, x, yBottom);
  }

  /**
   * Dibuja el título de una sección y, mediante `bodyFn`, su contenido.
   * Al terminar, traza la línea vertical lateral que reemplaza el antiguo
   * subrayado horizontal, cubriendo desde el título hasta la última fila.
   * `bodyFn` recibe el y disponible para la primera fila y debe devolver el
   * y final (sin el espacio extra entre secciones).
   */
  function drawSection(doc, x, y, title, bodyFn) {
    const topY = y - 4.2;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...BRAND.ink);
    doc.text(title, x, y);

    const endY = bodyFn(y + 6.5);

    drawVerticalRule(doc, x - 2.6, topY, endY - 3.4);

    return endY;
  }

  /** Fila estándar "etiqueta ... valor (unidad)" dentro de una columna. */
  function drawRow(doc, x, y, row, index, width) {
    if (index % 2 === 0) {
      doc.setFillColor(...BRAND.accentLight);
      doc.rect(x, y - 4.1, width, ROW_H, "F");
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(ROW_FONT_SIZE);
    doc.setTextColor(...BRAND.ink);
    doc.text(row.label, x + 2.5, y);

    const valueText = row.unit ? `${row.value} ${row.unit}` : row.value;
    doc.setFont("courier", "bold");
    doc.setFontSize(ROW_FONT_SIZE);
    doc.setTextColor(...BRAND.accent);
    doc.text(valueText, x + width - 2.5, y, { align: "right" });

    return y + ROW_H;
  }

  /** Fila compacta con dos valores en una sola línea (muestras, avance). */
  function drawInlineRow(doc, x, y, index, label, midValue, rightValue, width) {
    if (index % 2 === 0) {
      doc.setFillColor(...BRAND.accentLight);
      doc.rect(x, y - 4.1, width, SAMPLE_ROW_H, "F");
    }

    const midX = x + width * 0.56;
    const rightX = x + width - 2.5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(ROW_FONT_SIZE);
    doc.setTextColor(...BRAND.ink);
    doc.text(label, x + 2.5, y);

    doc.setFont("courier", "normal");
    doc.setFontSize(ROW_FONT_SIZE);
    doc.setTextColor(...BRAND.ink);
    doc.text(midValue, midX, y, { align: "right" });

    doc.setFont("courier", "bold");
    doc.setFontSize(ROW_FONT_SIZE);
    doc.setTextColor(...BRAND.accent);
    doc.text(rightValue, rightX, y, { align: "right" });

    return y + SAMPLE_ROW_H;
  }

  /**
   * Fila "de resultado" a todo el ancho de la columna: regla superior +
   * etiqueta en negrita + valor destacado, igual formato que "Gasto de
   * boquilla promedio". Se usa para totales que deben resaltar sobre el
   * resto de las filas (p.ej. Caldo total calculado, Caldo a preparar
   * redondeado), pudiendo apilarse una debajo de la otra.
   */
  function drawTotalRow(doc, x, y, width, label, valueText, withLine = true) {
    let ry = y + (withLine ? 3 : 0);

    if (withLine) {
      doc.setDrawColor(...BRAND.accent);
      doc.setLineWidth(0.5);
      doc.line(x, ry - 3.6, x + width, ry - 3.6);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(ROW_FONT_SIZE);
    doc.setTextColor(...BRAND.ink);
    doc.text(label, x + 2.5, ry);

    doc.setFont("courier", "bold");
    doc.setFontSize(ROW_FONT_SIZE);
    doc.setTextColor(...BRAND.accent);
    doc.text(valueText, x + width - 2.5, ry, { align: "right" });

    return ry + ROW_H;
  }

  /** Columna superior izquierda: ítem 1 (muestras + promedio) seguido del ítem 2 (Velocidad). */
  function drawLeftColumn(doc, x, y, reportState, width) {
    let cy = drawSection(doc, x, y, "1. Calibración de boquilla", (rowY) => {
      let ry = rowY;
      reportState.samples.forEach((sample, i) => {
        ry = drawInlineRow(doc, x, ry, i, sample.label, `${sample.volume} L/20s`, `${sample.gasto} L/min`, width);
      });

      return drawTotalRow(
        doc,
        x,
        ry,
        width,
        "Gasto de boquilla promedio",
        `${reportState.gastoPromedio.value} ${reportState.gastoPromedio.unit}`
      );
    });

    cy += SECTION_GAP;

    cy = drawVelocidadSection(doc, x, cy, reportState.velocidad, width);

    return cy;
  }

  /** Ítem 2 (Velocidad): ancho de boquilla, avance (ingresado + calculado), cobertura y mojamiento. */
  function drawVelocidadSection(doc, x, y, velocidad, width) {
    return drawSection(doc, x, y, velocidad.title, (rowY) => {
      let ry = drawRow(doc, x, rowY, velocidad.ancho, 0, width);
      ry = drawInlineRow(doc, x, ry, 1, velocidad.avance.label, velocidad.avance.msValue, velocidad.avance.mminValue, width);
      ry = drawRow(doc, x, ry, velocidad.cobertura, 2, width);
      ry = drawRow(doc, x, ry, velocidad.mojamiento, 3, width);
      return ry;
    });
  }

  /**
   * Columna superior derecha: ítem 3 (Caldo, incluye área de ensayo).
   * Caldo total calculado y Caldo a preparar redondeado se dibujan en
   * formato de resultado, uno debajo del otro.
   */
  function drawRightColumn(doc, x, y, reportState, width) {
    const caldo = reportState.caldo;
    return drawSection(doc, x, y, caldo.title, (rowY) => {
      let ry = drawRow(doc, x, rowY, caldo.area, 0, width);
      ry = drawRow(doc, x, ry, caldo.caldoNecesario, 1, width);
      ry = drawRow(doc, x, ry, caldo.remanente, 2, width);
      ry = drawTotalRow(doc, x, ry, width, caldo.caldoTotal.label, `${caldo.caldoTotal.value} ${caldo.caldoTotal.unit}`, true);
      ry = drawTotalRow(
        doc,
        x,
        ry,
        width,
        caldo.caldoPreparar.label,
        `${caldo.caldoPreparar.value} ${caldo.caldoPreparar.unit}`,
        false
      );
      return ry;
    });
  }

  /**
   * Dibuja las líneas de una celda (ya divididas con splitTextToSize),
   * centrándolas verticalmente respecto al máximo de líneas de la fila.
   */
  function drawCellLines(doc, lines, xPos, cy, maxLines, align) {
    const startOffset = ((maxLines - lines.length) * LINE_H) / 2;
    lines.forEach((line, li) => {
      const ly = cy + startOffset + li * LINE_H;
      if (align) {
        doc.text(line, xPos, ly, { align });
      } else {
        doc.text(line, xPos, ly);
      }
    });
  }

  /** Ítem 4, a todo el ancho: tabla de tratamientos con notación de suma. */
  function drawTreatmentsTable(doc, x, y, treatments, width) {
    return drawSection(doc, x, y, "4. Tratamientos", (rowY) => {
      let cy = rowY;

      // Columna de índice y de dosis reducidas, para dar más espacio a los
      // nombres de producto y así necesitar menos seguido pasar a 2 líneas.
      const cols = [
        { key: "label", header: "", w: width * 0.04, align: "center" },
        { key: "productos", header: "Producto(s)", w: width * 0.37, align: "left" },
        { key: "dosis", header: "Dosis (kg o L/ha)", w: width * 0.19, align: "right" },
        { key: "dosisCarga", header: "Dosis por carga (g o mL)", w: width * 0.25, align: "right" },
        { key: "remanente", header: "Remanente (L)", w: width * 0.15, align: "right" },
      ];

      let cx = x;
      const colX = cols.map((c) => {
        const thisX = cx;
        cx += c.w;
        return thisX;
      });

      // Encabezado de la tabla
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...BRAND.textMuted);
      cols.forEach((c, i) => {
        if (!c.header) return;
        const tx = c.align === "right" ? colX[i] + c.w - 2.5 : colX[i] + 2.5;
        doc.text(c.header, tx, cy, { align: c.align === "right" ? "right" : "left", maxWidth: c.w - 4 });
      });
      cy += 2.5;
      doc.setDrawColor(...BRAND.accent);
      doc.setLineWidth(0.4);
      doc.line(x, cy, x + width, cy);
      cy += 5.5;

      treatments.forEach((t, i) => {
        const prodLines = doc.splitTextToSize(t.productos, cols[1].w - 4);
        const dosisLines = doc.splitTextToSize(t.dosis, cols[2].w - 4);
        const dosisCargaLines = doc.splitTextToSize(t.dosisCarga, cols[3].w - 4);
        const remanenteLines = doc.splitTextToSize(t.remanente, cols[4].w - 4);
        const maxLines = Math.max(1, prodLines.length, dosisLines.length, dosisCargaLines.length, remanenteLines.length);
        const rowHeight = ROW_H + (maxLines - 1) * LINE_H;

        if (i % 2 === 0) {
          doc.setFillColor(...BRAND.accentLight);
          doc.rect(x, cy - 4.1, width, rowHeight, "F");
        }

        const centerY = cy + ((maxLines - 1) * LINE_H) / 2;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(ROW_FONT_SIZE);
        doc.setTextColor(...BRAND.ink);
        doc.text(t.label, colX[0] + cols[0].w / 2, centerY, { align: "center" });

        doc.setFont("helvetica", "normal");
        doc.setTextColor(...BRAND.ink);
        drawCellLines(doc, prodLines, colX[1] + 2.5, cy, maxLines);

        doc.setFont("courier", "bold");
        doc.setTextColor(...BRAND.accent);
        drawCellLines(doc, dosisLines, colX[2] + cols[2].w - 2.5, cy, maxLines, "right");
        drawCellLines(doc, dosisCargaLines, colX[3] + cols[3].w - 2.5, cy, maxLines, "right");

        doc.setFont("courier", "normal");
        doc.setTextColor(...BRAND.ink);
        drawCellLines(doc, remanenteLines, colX[4] + cols[4].w - 2.5, cy, maxLines, "right");

        cy += rowHeight;
      });

      return cy;
    });
  }

  async function generate(reportState) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error("jsPDF no está disponible todavía.");
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: PAGE.format, compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const { marginX, columnGap } = PAGE;

    const contentWidth = pageWidth - marginX * 2;
    const colWidth = (contentWidth - columnGap) / 2;
    const leftX = marginX;
    const rightX = marginX + colWidth + columnGap;

    const logoDataUrl = await loadLogoDataUrl();

    let y0 = drawHeader(doc, pageWidth, logoDataUrl);

    // Columnas superiores: izquierda (ítems 1-2) y derecha (ítem 3)
    const yLeftEnd = drawLeftColumn(doc, leftX, y0, reportState, colWidth);
    const yRightEnd = drawRightColumn(doc, rightX, y0, reportState, colWidth);

    let y = Math.max(yLeftEnd, yRightEnd) + 3;

    // Salvaguarda: si por algún motivo el contenido no cupiera en una sola
    // página (p.ej. muchos tratamientos o nombres largos que ocupan varias
    // líneas), se continúa en una página nueva en vez de dibujar fuera del
    // área visible.
    const estimatedTableHeight = 12 + reportState.treatments.length * (ROW_H + LINE_H) + 6;
    if (y + estimatedTableHeight > pageHeight - PAGE.marginBottom) {
      doc.addPage();
      y = drawHeader(doc, pageWidth, logoDataUrl);
    }

    // Ítem 4, a todo el ancho
    drawTreatmentsTable(doc, marginX, y, reportState.treatments, contentWidth);

    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      drawFooter(doc, pageWidth, pageHeight);
    }

    doc.save(reportState.fileName);
  }

  window.DosisPDF = { generate };
})();
