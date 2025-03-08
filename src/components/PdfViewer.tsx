'use client';

import { useState } from 'react';
import { Document, Page } from 'react-pdf';
import { Box, Skeleton,  ButtonGroup, Button, Flex } from '@chakra-ui/react';
import { pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface PdfViewerProps {
  url: string;
}

export default function PdfViewer({ url }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>();
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }): void {
    setNumPages(numPages);
  }

  return (
    <Box>
      <Flex mb={4} gap={2} align="center">
        <ButtonGroup >
          <Button
            onClick={() => setScale(Math.max(0.5, scale - 0.1))}
            disabled={scale <= 0.5}
          >
            -
          </Button>
          <Button pointerEvents="none">{Math.round(scale * 100)}%</Button>
          <Button
            onClick={() => setScale(Math.min(2, scale + 0.1))}
            disabled={scale >= 2}
          >
            +
          </Button>
        </ButtonGroup>

        <ButtonGroup>
          <Button
            onClick={() => setPageNumber(p => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
          >
            Previous
          </Button>
          <Button pointerEvents="none">
            Page {pageNumber} of {numPages}
          </Button>
          <Button
            onClick={() => setPageNumber(p => Math.min(p + 1, numPages || 1))}
            disabled={pageNumber >= (numPages || 1)}
          >
            Next
          </Button>
        </ButtonGroup>
      </Flex>

      <Document
        file={url}
        onLoadSuccess={onDocumentLoadSuccess}
        loading={<Skeleton height="500px" />}
      >
        <Page 
          pageNumber={pageNumber}
          scale={scale}
          loading={<Skeleton height="500px" />}
        />
      </Document>
    </Box>
  );
}