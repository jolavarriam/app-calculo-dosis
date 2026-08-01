/**
 * DosisCalc — Generador de informe PDF (tamaño carta).
 * Usa jsPDF (vendorizado en vendor/jspdf.umd.min.js, MIT license) para poder
 * generar el PDF sin conexión una vez que la PWA quedó instalada/cacheada.
 *
 * Layout: arriba, en dos columnas — izquierda: ítem 1 (muestras de
 * calibración, siempre 3) + ítems 2 a 4; derecha: ítems 5 a 7. Debajo, a todo
 * el ancho, el ítem 8 (Tratamientos): una fila por tratamiento, con los
 * nombres de producto, dosis y dosis por carga en notación de suma literal
 * (no calculada), y el remanente del tratamiento.
 *
 * Expone window.DosisPDF.generate(reportState) donde reportState es:
 * {
 *   fileName: string,
 *   samples: [{ label, volume, gasto }],       // siempre 3 muestras
 *   gastoPromedio: { value, unit },
 *   leftColumnSections: [ { title, rows: [{ label, value, unit }] } ],  // ítems 2-4
 *   rightColumnSections: [ { title, rows: [{ label, value, unit }] } ], // ítems 5-7
 *   treatments: [ { label, productos, dosis, dosisCarga, remanente } ], // ítem 8
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
  const SAMPLE_ROW_H = 5.6; // alto de fila compacta para muestras (siempre 3)

  function formatTimestamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    const fecha = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    const hora = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return `${fecha} · ${hora}`;
  }

  function drawHeader(doc, pageWidth) {
    const { marginX, marginTop } = PAGE;

    // Isotipo "DC"
    doc.setFillColor(...BRAND.ink);
    doc.roundedRect(marginX, marginTop - 6, 10, 10, 2, 2, "F");
    doc.setTextColor(217, 168, 108);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("DC", marginX + 5, marginTop - 0.3, { align: "center" });

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

  /** Título de sub-sección dentro de una columna de ancho `width` en x. */
  function drawSectionTitle(doc, x, y, title, width) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...BRAND.ink);
    doc.text(title, x, y);

    doc.setDrawColor(...BRAND.accent);
    doc.setLineWidth(0.6);
    doc.line(x, y + 1.5, x + 12, y + 1.5);

    return y + 6.5;
  }

  /** Fila estándar "label ... valor" dentro de una columna de ancho `width` en x. */
  function drawRow(doc, x, y, row, index, width) {
    if (index % 2 === 0) {
      doc.setFillColor(...BRAND.accentLight);
      doc.rect(x, y - 4.1, width, ROW_H, "F");
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.ink);
    doc.text(row.label, x + 2.5, y);

    const valueText = row.unit ? `${row.value} ${row.unit}` : row.value;
    doc.setFont("courier", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.accent);
    doc.text(valueText, x + width - 2.5, y, { align: "right" });

    return y + ROW_H;
  }

  /** Fila compacta de una muestra: "Mn   0,45 L   1,35 L/min" en una sola línea. */
  function drawSampleRow(doc, x, y, index, sample, width) {
    if (index % 2 === 0) {
      doc.setFillColor(...BRAND.accentLight);
      doc.rect(x, y - 3.9, width, SAMPLE_ROW_H, "F");
    }

    const volX = x + width * 0.56;
    const gastoX = x + width - 2.5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(...BRAND.ink);
    doc.text(sample.label, x + 2.5, y);

    doc.setFont("courier", "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(...BRAND.ink);
    doc.text(`${sample.volume} L`, volX, y, { align: "right" });

    doc.setFont("courier", "bold");
    doc.setFontSize(8.2);
    doc.setTextColor(...BRAND.accent);
    doc.text(`${sample.gasto} L/min`, gastoX, y, { align: "right" });

    return y + SAMPLE_ROW_H;
  }

  /** Columna izquierda: ítem 1 (muestras + promedio) seguido de los ítems 2-4. */
  function drawLeftColumn(doc, x, y, reportState, width) {
    let cy = drawSectionTitle(doc, x, y, "1. Calibración de boquilla", width);

    reportState.samples.forEach((sample, i) => {
      cy = drawSampleRow(doc, x, cy, i, sample, width);
    });

    // Espacio + regla superior sutil antes del promedio, para diferenciarlo
    // de las muestras individuales sin usar un bloque de color fuerte.
    cy += 3;
    doc.setDrawColor(...BRAND.accent);
    doc.setLineWidth(0.5);
    doc.line(x, cy - 3.6, x + width, cy - 3.6);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.ink);
    doc.text("Gasto de boquilla promedio", x + 2.5, cy);

    doc.setFont("courier", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...BRAND.accent);
    doc.text(`${reportState.gastoPromedio.value} ${reportState.gastoPromedio.unit}`, x + width - 2.5, cy, {
      align: "right",
    });

    cy += ROW_H + 2.5;

    // Ítems 2 a 4, en la misma columna
    reportState.leftColumnSections.forEach((section) => {
      cy = drawSectionTitle(doc, x, cy, section.title, width);
      section.rows.forEach((row, i) => {
        cy = drawRow(doc, x, cy, row, i, width);
      });
      cy += 2.5;
    });

    return cy;
  }

  /** Columna derecha: ítems 5 a 7, cada uno con su título y filas. */
  function drawSectionsColumn(doc, x, y, sections, width) {
    let cy = y;
    sections.forEach((section) => {
      cy = drawSectionTitle(doc, x, cy, section.title, width);
      section.rows.forEach((row, i) => {
        cy = drawRow(doc, x, cy, row, i, width);
      });
      cy += 2.5;
    });
    return cy;
  }

  /** Ítem 8, a todo el ancho: tabla de tratamientos con notación de suma. */
  function drawTreatmentsTable(doc, x, y, treatments, width) {
    let cy = drawSectionTitle(doc, x, y, "8. Tratamientos", width);

    const cols = [
      { key: "label", header: "Tratamiento", w: width * 0.14, align: "left" },
      { key: "productos", header: "Producto(s)", w: width * 0.32, align: "left" },
      { key: "dosis", header: "Dosis (kg o L/ha)", w: width * 0.2, align: "right" },
      { key: "dosisCarga", header: "Dosis por carga", w: width * 0.2, align: "right" },
      { key: "remanente", header: "Remanente (L)", w: width * 0.14, align: "right" },
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
      const tx = c.align === "right" ? colX[i] + c.w - 2.5 : colX[i] + 2.5;
      doc.text(c.header, tx, cy, { align: c.align === "right" ? "right" : "left", maxWidth: c.w - 4 });
    });
    cy += 2.5;
    doc.setDrawColor(...BRAND.accent);
    doc.setLineWidth(0.4);
    doc.line(x, cy, x + width, cy);
    cy += 5.5;

    treatments.forEach((t, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(...BRAND.accentLight);
        doc.rect(x, cy - 4.1, width, ROW_H, "F");
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...BRAND.ink);
      doc.text(t.label, colX[0] + 2.5, cy, { maxWidth: cols[0].w - 4 });

      doc.setFont("helvetica", "normal");
      doc.text(t.productos, colX[1] + 2.5, cy, { maxWidth: cols[1].w - 4 });

      doc.setFont("courier", "bold");
      doc.setTextColor(...BRAND.accent);
      doc.text(t.dosis, colX[2] + cols[2].w - 2.5, cy, { align: "right", maxWidth: cols[2].w - 4 });
      doc.text(t.dosisCarga, colX[3] + cols[3].w - 2.5, cy, { align: "right", maxWidth: cols[3].w - 4 });

      doc.setFont("courier", "normal");
      doc.setTextColor(...BRAND.ink);
      doc.text(t.remanente, colX[4] + cols[4].w - 2.5, cy, { align: "right" });

      cy += ROW_H;
    });

    return cy;
  }

  function generate(reportState) {
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

    let y0 = drawHeader(doc, pageWidth);

    // Columnas superiores: izquierda (ítems 1-4) y derecha (ítems 5-7)
    const yLeftEnd = drawLeftColumn(doc, leftX, y0, reportState, colWidth);
    const yRightEnd = drawSectionsColumn(doc, rightX, y0, reportState.rightColumnSections, colWidth);

    let y = Math.max(yLeftEnd, yRightEnd) + 4;

    // Salvaguarda: si por algún motivo el contenido no cupiera en una sola
    // página (p.ej. muchos tratamientos), se continúa en una página nueva en
    // vez de dibujar fuera del área visible.
    const estimatedTableHeight = 12 + reportState.treatments.length * ROW_H + 6;
    if (y + estimatedTableHeight > pageHeight - PAGE.marginBottom) {
      doc.addPage();
      y = drawHeader(doc, pageWidth);
    }

    // Ítem 8, a todo el ancho
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
