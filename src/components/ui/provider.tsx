"use client"

import { ChakraProvider, defaultSystem } from "@chakra-ui/react"
import {
  ColorModeProvider,
} from "./color-mode"
import { ThemeProviderProps } from "next-themes"

/*************  ✨ Codeium Command ⭐  *************/
/******  548bac45-2463-4211-8c74-d63d7b68b362  *******/
export function Provider(props: ThemeProviderProps) {
  return (
    <ChakraProvider value={defaultSystem}>
      <ColorModeProvider {...props} />
    </ChakraProvider>
  )
}
