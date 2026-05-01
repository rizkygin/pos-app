'use client'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { MessageCircle } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"

export const MessageChatComponent = () => {
    return (
        <Collapsible>
            <CollapsibleTrigger>
                <div className="fixed bottom-8 right-8 z-50">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all hover:scale-110 hover:shadow-xl active:scale-95">
                        <MessageCircle className="h-6 w-6" />
                    </div>
                </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <AnimatePresence>
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                        transition={{ duration: 0.3 }}
                        className="fixed bottom-8 right-22 z-50 w-100 h-100 bg-background border rounded-xl shadow-lg p-2">

                    </motion.div>
                </AnimatePresence>

            </CollapsibleContent>
        </Collapsible>
    )
}

export default MessageChatComponent;